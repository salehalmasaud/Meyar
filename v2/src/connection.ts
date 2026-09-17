export type Connection = 'Live'|'Fallback polling'|'Offline';
export function connectionStatus(realtime:boolean, reachable:boolean):Connection { return !reachable?'Offline':realtime?'Live':'Fallback polling'; }
export function pollingDelay(realtime:boolean, reachable:boolean):number { return realtime&&reachable?15000:4000; }
