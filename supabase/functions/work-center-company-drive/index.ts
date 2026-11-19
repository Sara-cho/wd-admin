import {handle} from './drive.js';
Deno.serve((request: Request) => handle(request, (name: string) => Deno.env.get(name)));
