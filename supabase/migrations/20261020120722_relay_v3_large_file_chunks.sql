-- Additive Relay V3 large-file uploads. Existing small files and immutable notes are unchanged.
BEGIN;

ALTER TABLE public.relay_v3_objects
  ADD COLUMN large boolean NOT NULL DEFAULT false;
ALTER TABLE public.relay_v3_objects
  DROP CONSTRAINT relay_v3_objects_size_check;
ALTER TABLE public.relay_v3_objects
  ADD CONSTRAINT relay_v3_objects_size_check CHECK (size BETWEEN 1 AND 104857600);

CREATE TABLE public.relay_v3_large_chunks (
  file_id uuid NOT NULL REFERENCES public.relay_v3_objects(id) ON DELETE CASCADE,
  idx integer NOT NULL CHECK (idx BETWEEN 0 AND 24),
  size integer NOT NULL CHECK (size BETWEEN 1 AND 4194304),
  digest text NOT NULL CHECK (digest ~ '^[A-Za-z0-9_-]{43}$'),
  PRIMARY KEY (file_id, idx)
);
ALTER TABLE public.relay_v3_large_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.relay_v3_large_chunks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.relay_v3_large_chunks TO service_role;

CREATE FUNCTION public.relay_v3_reserve_large(
  p_id uuid, p_mime text, p_size integer, p_source text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  used_bytes bigint;
  used_items integer;
BEGIN
  IF p_size < 1 OR p_size > 104857600 OR
     p_source NOT IN ('Phone','Workstation') OR
     p_mime NOT IN (
       'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
       'application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'video/mp4','video/quicktime'
     ) THEN RETURN false; END IF;
  PERFORM 1 FROM public.relay_v3_state WHERE id=1 FOR UPDATE;
  SELECT COALESCE(SUM(size),0), COUNT(*)
    INTO used_bytes, used_items
    FROM public.relay_v3_objects
    WHERE kind='file' AND expires_at>NOW();
  IF used_bytes+p_size>419430400 OR used_items>=100 THEN RETURN false; END IF;
  INSERT INTO public.relay_v3_objects
    (id,kind,mime,size,source,large,ready,expires_at)
    VALUES (p_id,'file',p_mime,p_size,p_source,true,false,NOW()+INTERVAL '90 minutes');
  RETURN true;
END;
$$;

CREATE FUNCTION public.relay_v3_record_large_chunk(
  p_id uuid, p_index integer, p_size integer, p_digest text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  file_size integer;
  total integer;
  expected integer;
  prior public.relay_v3_large_chunks%ROWTYPE;
BEGIN
  SELECT size INTO file_size
    FROM public.relay_v3_objects
    WHERE id=p_id AND kind='file' AND large=true AND ready=false AND expires_at>NOW()
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  total := (file_size+4194304-1)/4194304;
  IF p_index IS NULL OR p_index<0 OR p_index>=total OR p_size IS NULL OR
     p_digest IS NULL OR p_digest !~ '^[A-Za-z0-9_-]{43}$'
  THEN RETURN false; END IF;
  expected := LEAST(4194304, file_size-p_index*4194304);
  IF p_size<>expected THEN RETURN false; END IF;
  INSERT INTO public.relay_v3_large_chunks(file_id,idx,size,digest)
    VALUES(p_id,p_index,p_size,p_digest)
    ON CONFLICT (file_id,idx) DO NOTHING;
  SELECT * INTO prior FROM public.relay_v3_large_chunks WHERE file_id=p_id AND idx=p_index;
  RETURN prior.size=p_size AND prior.digest=p_digest;
END;
$$;

CREATE FUNCTION public.relay_v3_finish_large(p_id uuid,p_ttl integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  file_size integer;
  expected_parts integer;
  found_parts integer;
  found_bytes bigint;
BEGIN
  IF p_ttl<60 OR p_ttl>604800 THEN RETURN false; END IF;
  PERFORM 1 FROM public.relay_v3_state WHERE id=1 FOR UPDATE;
  SELECT size INTO file_size
    FROM public.relay_v3_objects
    WHERE id=p_id AND kind='file' AND large=true AND ready=false AND expires_at>NOW()
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  expected_parts := (file_size+4194304-1)/4194304;
  SELECT COUNT(*),COALESCE(SUM(size),0) INTO found_parts,found_bytes
    FROM public.relay_v3_large_chunks WHERE file_id=p_id;
  IF found_parts<>expected_parts OR found_bytes<>file_size THEN RETURN false; END IF;
  UPDATE public.relay_v3_objects
    SET ready=true,expires_at=NOW()+make_interval(secs=>p_ttl)
    WHERE id=p_id;
  UPDATE public.relay_v3_state SET revision=revision+1 WHERE id=1;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.relay_v3_reserve_large(uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.relay_v3_record_large_chunk(uuid,integer,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.relay_v3_finish_large(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.relay_v3_reserve_large(uuid,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.relay_v3_record_large_chunk(uuid,integer,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.relay_v3_finish_large(uuid,integer) TO service_role;

COMMIT;
