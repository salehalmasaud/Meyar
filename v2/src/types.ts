export interface RelayNote { text:string; version:number; received_at:string; expires_at:string }
export interface RelayFile { id:string; name:string; mime:string; size:number; source:string; created_at:string; expires_at:string }
export interface ViewerSession { token:string; expires_at:number; edge:string; realtime:{url:string;anon:string;topic:string}; text_ttl:number; file_ttl:number }
export interface RelayState { revision:number; server_time:number; unchanged?:boolean; note:RelayNote|null; files:RelayFile[] }
