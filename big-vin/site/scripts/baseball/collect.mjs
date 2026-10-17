#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./collect.py',import.meta.url));
const result=spawnSync(process.env.BIG_VIN_PYTHON||'python3',[script,...process.argv.slice(2)],{stdio:'inherit'});
if(result.error){console.error(result.error.message);process.exit(1);}
process.exit(result.status??1);
