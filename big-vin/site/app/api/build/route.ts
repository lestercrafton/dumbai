import {BUILD} from '@/lib/build-info';
/** The deployed build marker; open tabs compare it with their own and reload when it changes. */
export function GET(){return Response.json({build:BUILD},{headers:{'Cache-Control':'no-store'}});}
