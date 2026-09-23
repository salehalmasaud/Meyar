import {b64,decoder,decryptText,equalSecret,hash,hmac,randomToken,readJson,readLimited,RelayError,unb64,utf8,verifyHmac} from './core.ts';
import type {Settings} from './config.ts';
import {Store,type FileRow} from './store.ts';
import {sendNote} from './sender.ts';

const sendScope='notes.write';
const fileScope='files.read';
const supportedScopes=[sendScope,fileScope];
const allScopes=supportedScopes.join(' ');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sendSchema={
  type:'object',
  properties:{note:{type:'string',description:'The exact latest final Dietitian Note, preserving every character, space and line break.',minLength:1,maxLength:65536}},
  required:['note'],
  additionalProperties:false
};

const fileItemSchema={
  type:'object',
  properties:{
    id:{type:'string'},
    name:{type:'string'},
    mime:{type:'string'},
    size:{type:'integer'},
    source:{type:'string'},
    created_at:{type:'string'},
    expires_at:{type:'string'}
  },
  required:['id','name','mime','size','source','created_at','expires_at'],
  additionalProperties:false
};

export const sendTool={
  name:'send_note',
  title:'Send note to work',
  description:'Appends the supplied note text verbatim to the private Trackcare Relay V3 work inbox. Existing notes remain. Notes expire independently after 12 hours. Returns a receipt containing success, note_id and version, without note content. Each new call appends a separate note; transport retries of the same request reuse its receipt. Requires notes.write authorization.',
  inputSchema:sendSchema,
  outputSchema:{type:'object',properties:{success:{type:'boolean'},note_id:{type:'string'},version:{type:'integer'}},required:['success','note_id','version'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},
  securitySchemes:[{type:'oauth2',scopes:[sendScope]}],
  _meta:{securitySchemes:[{type:'oauth2',scopes:[sendScope]}]}
};

export const listFilesTool={
  name:'list_files',
  title:'Find Relay files',
  description:'Lists active files uploaded to the private Trackcare Relay V3 inbox. Use query to match part of a filename, for example p30. This is read-only and never changes or deletes files.',
  inputSchema:{
    type:'object',
    properties:{query:{type:'string',description:'Optional filename text to match, case-insensitive.',maxLength:180}},
    additionalProperties:false
  },
  outputSchema:{type:'object',properties:{files:{type:'array',items:fileItemSchema}},required:['files'],additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  securitySchemes:[{type:'oauth2',scopes:[fileScope]}],
  _meta:{securitySchemes:[{type:'oauth2',scopes:[fileScope]}]}
};

export const getFileTool={
  name:'get_file',
  title:'Get Relay file',
  description:'Retrieves one active file from the private Trackcare Relay V3 inbox by the file_id returned from list_files. Returns a short-lived private resource link for the file. This is read-only and never changes or deletes files.',
  inputSchema:{
    type:'object',
    properties:{file_id:{type:'string',description:'The Relay file ID returned by list_files.'}},
    required:['file_id'],
    additionalProperties:false
  },
  outputSchema:{
    type:'object',
    properties:{
      file:{
        type:'object',
        properties:{
          id:{type:'string'},
          name:{type:'string'},
          mime:{type:'string'},
          size:{type:'integer'},
          source:{type:'string'},
          created_at:{type:'string'},
          expires_at:{type:'string'},
          download_url:{type:'string'},
          link_expires_at:{type:'integer'}
        },
        required:['id','name','mime','size','source','created_at','expires_at','download_url','link_expires_at'],
        additionalProperties:false
      }
    },
    required:['file'],
    additionalProperties:false
  },
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  securitySchemes:[{type:'oauth2',scopes:[fileScope]}],
  _meta:{securitySchemes:[{type:'oauth2',scopes:[fileScope]}]}
};

type Token={grant_id:string;client_id:string;resource:string;scope:string};

export function createConnector(c:Settings,db:Store){
  const base=c.origins[0],resource=base+'/mcp';
  const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
  const json=(v:unknown,status=200,extra:Record<string,string>={})=>Response.json(v,{status,headers:{...headers,...extra}});
  const current=()=>encodeURIComponent(new Date().toISOString());

  function challenge(scopes=supportedScopes,error?:string){
    return 'Bearer resource_metadata="'+base+'/.well-known/oauth-protected-resource", scope="'+scopes.join(' ')+'"'+
      (error?', error="'+error+'", error_description="Additional Relay authorization is required"':'');
  }

  function normalizeScope(value:unknown){
    const requested=typeof value==='string'&&value.trim()?[...new Set(value.trim().split(/\s+/))]:supportedScopes;
    if(!requested.length||requested.some(s=>!supportedScopes.includes(s)))throw new RelayError(400,'invalid_scope');
    return supportedScopes.filter(s=>requested.includes(s)).join(' ');
  }

  function hasScope(token:Token,needed:string){
    return new Set((token.scope||'').split(/\s+/).filter(Boolean)).has(needed);
  }

  async function limit(key:string,n:number){
    if(!await db.rpc('limit',{p_key:key,p_limit:n,p_seconds:60}))throw new RelayError(429,'try_later');
  }

  async function authenticate(req:Request):Promise<Token>{
    const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new RelayError(401,'unauthorized');
    const rows=await db.db<Token[]>('relay_v3_oauth_tokens?hash=eq.'+await hash(token)+'&kind=eq.access&expires_at=gt.'+current());
    if(rows[0]?.resource!==resource)throw new RelayError(401,'unauthorized');
    return rows[0];
  }

  function validateResource(v:unknown){
    if(v!==resource)throw new RelayError(400,'invalid_target');
  }

  async function fileInfo(id:string){
    return JSON.parse(await decryptText(await(await db.get(id,'meta')).json(),c.encryption,'file-info-v3.'+id)) as {name:string};
  }

  async function activeFiles(){
    return db.db<FileRow[]>('relay_v3_objects?kind=eq.file&ready=eq.true&expires_at=gt.'+current()+'&order=created_at.desc&limit=100');
  }

  async function fileItem(row:FileRow){
    const meta=await fileInfo(row.id);
    return {id:row.id,name:meta.name,mime:row.mime,size:row.size,source:row.source,created_at:row.created_at,expires_at:row.expires_at};
  }

  async function liveFile(id:string){
    if(!UUID.test(id))throw new RelayError(400,'invalid_request');
    const rows=await db.db<FileRow[]>('relay_v3_objects?id=eq.'+id+'&kind=eq.file&ready=eq.true&expires_at=gt.'+current());
    if(!rows.length)throw new RelayError(404,'file_expired');
    return rows[0];
  }

  return async(req:Request,path:string):Promise<Response>=>{
    try{
      if(!await equalSecret(req.headers.get('x-relay-gateway')||'',c.gateway))throw new RelayError(401,'unauthorized');

      if(path==='/.well-known/oauth-protected-resource'&&req.method==='GET'){
        return json({resource,authorization_servers:[base],scopes_supported:supportedScopes,bearer_methods_supported:['header']});
      }

      if(path==='/.well-known/oauth-authorization-server'&&req.method==='GET'){
        return json({
          issuer:base,
          authorization_endpoint:base+'/connect.html',
          token_endpoint:base+'/oauth/token',
          registration_endpoint:base+'/oauth/register',
          revocation_endpoint:base+'/oauth/revoke',
          response_types_supported:['code'],
          grant_types_supported:['authorization_code','refresh_token'],
          token_endpoint_auth_methods_supported:['none'],
          code_challenge_methods_supported:['S256'],
          scopes_supported:supportedScopes,
          authorization_response_iss_parameter_supported:true
        });
      }

      const ip=await hmac(c.rate,'oauth-ip.'+(req.headers.get('x-relay-client')||'unknown'));

      if(path==='/oauth/register'&&req.method==='POST'){
        await limit('register.'+ip,10);
        const b=await readJson(req,4096);
        if(!Array.isArray(b.redirect_uris)||b.redirect_uris.length!==1||b.redirect_uris[0]!=='https://chatgpt.com/connector_platform_oauth_redirect'||(b.token_endpoint_auth_method&&b.token_endpoint_auth_method!=='none'))throw new RelayError(400,'invalid_client_metadata');
        const id=randomToken();
        await db.db('relay_v3_oauth_clients','POST',{id,redirect_uri:b.redirect_uris[0]});
        return json({
          client_id:id,
          redirect_uris:b.redirect_uris,
          token_endpoint_auth_method:'none',
          grant_types:['authorization_code','refresh_token'],
          response_types:['code'],
          scope:allScopes
        },201);
      }

      if(path==='/oauth/authorize'&&req.method==='POST'){
        const viewer=req.headers.get('x-relay-session')||'';
        const sessions=await db.db<{hash:string}[]>('relay_v3_sessions?hash=eq.'+await hash(viewer)+'&unlocked=eq.true&expires_at=gt.'+current());
        if(!sessions.length)throw new RelayError(401,'viewer_login_required');
        await limit('authorize.'+sessions[0].hash,10);
        const b=await readJson(req,8192);
        validateResource(b.resource);
        const requestedScope=normalizeScope(b.scope);
        if(b.response_type!=='code'||b.code_challenge_method!=='S256'||typeof b.code_challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(b.code_challenge)||typeof b.state!=='string'||b.state.length>2048||typeof b.client_id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(b.client_id))throw new RelayError(400,'invalid_request');
        const clients=await db.db<{redirect_uri:string}[]>('relay_v3_oauth_clients?id=eq.'+b.client_id+'&expires_at=gt.'+current());
        if(clients[0]?.redirect_uri!==b.redirect_uri)throw new RelayError(400,'invalid_client');
        const code=randomToken();
        await db.db('relay_v3_oauth_codes','POST',{
          hash:await hash(code),
          client_id:b.client_id,
          redirect_uri:b.redirect_uri,
          challenge:b.code_challenge,
          resource,
          scope:requestedScope,
          expires_at:new Date(Date.now()+120000).toISOString()
        });
        const redirect=new URL(clients[0].redirect_uri);
        redirect.searchParams.set('code',code);
        redirect.searchParams.set('state',b.state);
        redirect.searchParams.set('iss',base);
        return json({redirect:redirect.href});
      }

      if((path==='/oauth/token'||path==='/oauth/revoke')&&req.method==='POST'){
        await limit('token.'+ip,60);
        if(!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))throw new RelayError(400,'invalid_request');
        const b=Object.fromEntries(new URLSearchParams(decoder.decode(await readLimited(req,8192))));
        if(path==='/oauth/revoke'){
          const tokens=await db.db<Token[]>('relay_v3_oauth_tokens?hash=eq.'+await hash(b.token||''));
          if(tokens[0]?.client_id===b.client_id)await db.db('relay_v3_oauth_tokens?grant_id=eq.'+tokens[0].grant_id,'DELETE');
          return json({});
        }

        validateResource(b.resource);
        let grant:string|null=null;
        let grantedScope:string|null=null;

        if(b.grant_type==='authorization_code'){
          if(!/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier||''))throw new RelayError(400,'invalid_grant');
          grantedScope=await db.rpc<string|null>('oauth_redeem_scoped',{
            p_hash:await hash(b.code||''),
            p_client:b.client_id||'',
            p_challenge:await hash(b.code_verifier),
            p_redirect:b.redirect_uri||'',
            p_resource:resource
          });
          if(grantedScope)grant=crypto.randomUUID();
        }else if(b.grant_type==='refresh_token'){
          const refreshed=await db.rpc<{grant_id:string;scope:string}|null>('oauth_refresh_scoped',{
            p_hash:await hash(b.refresh_token||''),
            p_client:b.client_id||'',
            p_resource:resource
          });
          if(refreshed){grant=refreshed.grant_id;grantedScope=refreshed.scope;}
        }

        if(!grant||!grantedScope)throw new RelayError(400,'invalid_grant');
        grantedScope=normalizeScope(grantedScope);
        const access=randomToken(),refresh=randomToken();
        await db.db('relay_v3_oauth_tokens','POST',[
          {hash:await hash(access),grant_id:grant,client_id:b.client_id,kind:'access',resource,scope:grantedScope,expires_at:new Date(Date.now()+3600000).toISOString()},
          {hash:await hash(refresh),grant_id:grant,client_id:b.client_id,kind:'refresh',resource,scope:grantedScope,expires_at:new Date(Date.now()+30*86400000).toISOString()}
        ]);
        return json({access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:grantedScope});
      }

      if(path==='/mcp'){
        if(req.method==='GET'||req.method==='DELETE')return new Response(null,{status:405,headers:{...headers,allow:'POST'}});
        if(req.method!=='POST')throw new RelayError(405,'method_not_allowed');

        const auth=await authenticate(req);
        await limit('mcp.'+auth.grant_id,90);
        const b=await readJson(req,100000);
        if(b.jsonrpc!=='2.0'||typeof b.method!=='string')throw new RelayError(400,'invalid_request');

        const result=(value:unknown,extra:Record<string,string>={})=>json({jsonrpc:'2.0',id:b.id,result:value},200,extra);
        const insufficient=()=>result({
          isError:true,
          content:[{type:'text',text:'Additional Relay authorization is required to read uploaded files.'}],
          _meta:{'mcp/www_authenticate':[challenge(supportedScopes,'insufficient_scope')]}
        });

        if(b.method.startsWith('notifications/'))return new Response(null,{status:202,headers});
        if(!['string','number'].includes(typeof b.id))throw new RelayError(400,'invalid_request');

        if(b.method==='initialize'){
          const body=b.params as Record<string,unknown>;
          const payload=b64(utf8.encode(JSON.stringify({grant:auth.grant_id,id:crypto.randomUUID(),exp:Date.now()+12*3600000})));
          const session=payload+'.'+await hmac(c.ticket,'mcp-session.'+payload);
          return result({
            protocolVersion:['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(String(body?.protocolVersion))?body.protocolVersion:'2025-06-18',
            capabilities:{tools:{}},
            serverInfo:{name:'trackcare-relay-v3',version:'3.2.0'},
            instructions:'For an uploaded Relay file, call list_files with the filename or part of it, then call get_file with the selected file_id. File reads are read-only. Never delete or change Relay content.'
          },{'mcp-session-id':session});
        }

        if(b.method==='ping')return result({});
        if(b.method==='tools/list')return result({tools:[sendTool,listFilesTool,getFileTool]});

        if(b.method==='tools/call'){
          const mcpSession=req.headers.get('mcp-session-id')||'',parts=mcpSession.split('.');
          if(parts.length!==2||!await verifyHmac(c.ticket,'mcp-session.'+parts[0],parts[1]))throw new RelayError(400,'initialize_required');
          const s=JSON.parse(decoder.decode(unb64(parts[0],1024)));
          if(s.grant!==auth.grant_id||s.exp<=Date.now())throw new RelayError(404,'session_expired');

          const params=b.params as {name:string;arguments?:Record<string,unknown>};
          const args=params?.arguments||{};

          if(params?.name==='send_note'){
            if(!hasScope(auth,sendScope)){
              return result({
                isError:true,
                content:[{type:'text',text:'Relay note sending authorization is required.'}],
                _meta:{'mcp/www_authenticate':[challenge(supportedScopes,'insufficient_scope')]}
              });
            }
            if(Object.keys(args).join(',')!=='note')throw new RelayError(400,'invalid_request');
            try{
              const key=await hmac(c.rate,'mcp-request.'+auth.grant_id+'.'+s.id+'.'+typeof b.id+'.'+b.id);
              const receipt=await sendNote(args.note,key,auth.grant_id,c,db);
              return result({content:[{type:'text',text:JSON.stringify(receipt)}],structuredContent:receipt,isError:false});
            }catch(e){
              return result({isError:true,content:[{type:'text',text:JSON.stringify({success:false,error:e instanceof RelayError?e.code:'delivery_uncertain_do_not_resend'})}]});
            }
          }

          if(params?.name==='list_files'){
            if(!hasScope(auth,fileScope))return insufficient();
            if(Object.keys(args).some(k=>k!=='query')||(args.query!==undefined&&typeof args.query!=='string'))throw new RelayError(400,'invalid_request');
            try{
              const query=String(args.query||'').trim().toLocaleLowerCase();
              const rows=await activeFiles();
              const items=[];
              for(const row of rows){
                const item=await fileItem(row);
                if(!query||item.name.toLocaleLowerCase().includes(query))items.push(item);
              }
              return result({
                structuredContent:{files:items},
                content:[{type:'text',text:items.length?'Found '+items.length+' matching Relay file'+(items.length===1?'':'s')+'.':'No matching active Relay files were found.'}],
                isError:false
              });
            }catch(e){
              return result({isError:true,content:[{type:'text',text:JSON.stringify({error:e instanceof RelayError?e.code:'temporarily_unavailable'})}]});
            }
          }

          if(params?.name==='get_file'){
            if(!hasScope(auth,fileScope))return insufficient();
            if(Object.keys(args).length!==1||typeof args.file_id!=='string')throw new RelayError(400,'invalid_request');
            try{
              const row=await liveFile(args.file_id);
              const item=await fileItem(row);
              const exp=Math.min(Date.now()+c.signedTtl*1000,Date.parse(row.expires_at));
              if(exp<=Date.now())throw new RelayError(404,'file_expired');
              const mode='download';
              const signature=await hmac(c.link,'file-v3.'+row.id+'.'+exp+'.'+mode);
              const uri=c.url+'/functions/v1/relay-v3/file/'+row.id+'?expires='+exp+'&mode='+mode+'&signature='+signature;
              const file={...item,download_url:uri,link_expires_at:exp};
              return result({
                structuredContent:{file},
                content:[
                  {type:'resource_link',uri,name:item.name,title:item.name,description:'Temporary private Trackcare Relay file. The link expires within 60 seconds.',mimeType:item.mime,size:item.size},
                  {type:'text',text:'Retrieved Relay file: '+item.name}
                ],
                isError:false
              });
            }catch(e){
              return result({isError:true,content:[{type:'text',text:JSON.stringify({error:e instanceof RelayError?e.code:'temporarily_unavailable'})}]});
            }
          }

          throw new RelayError(400,'invalid_request');
        }

        return json({jsonrpc:'2.0',id:b.id,error:{code:-32601,message:'Method not found'}});
      }

      throw new RelayError(404,'not_found');
    }catch(e){
      const err=e instanceof RelayError?e:new RelayError(503,'temporarily_unavailable');
      return json({error:err.code},err.status,err.status===401?{'www-authenticate':challenge(supportedScopes)}:{});
    }
  };
}
