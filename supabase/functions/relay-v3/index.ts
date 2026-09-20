import {settings} from '../../../v3/server/config.ts';
import {createHandler} from '../../../v3/server/handler.ts';
// Custom HMAC send authentication; private gateway for viewers; scoped file tickets.
Deno.serve(createHandler(settings(k=>Deno.env.get(k))));
