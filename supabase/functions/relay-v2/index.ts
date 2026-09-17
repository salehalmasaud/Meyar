import { settings } from '../../../v2/server/config.ts';
import { createHandler } from '../../../v2/server/handler.ts';

// verify_jwt=false is required for the custom HMAC push protocol and opaque viewer sessions.
// Every sensitive route performs its own authentication before accessing data.
const handler=createHandler(settings(key=>Deno.env.get(key)));
Deno.serve(handler);
