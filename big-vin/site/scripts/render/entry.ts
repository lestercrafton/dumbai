// The public GET handlers the read cache serves, bundled for Node.
export {GET as slate} from '@/app/api/slate/route';
export {GET as results} from '@/app/api/results/route';
export {GET as learning} from '@/app/api/learning/route';
export {GET as collegeExperiment} from '@/app/api/college-experiment/route';
export {GET as playbook} from '@/app/api/playbook/route';
export {env} from 'cloudflare:workers';
