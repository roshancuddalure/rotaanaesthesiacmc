// Test-only native proxy: keeps multipart upload bodies out of browser interception.
import {defineConfig} from '../frontend/node_modules/vite/dist/node/index.js';
import {resolve} from 'node:path';
const root=resolve(process.env.FRONTEND_EQ_ROOT || 'frontend');
export default defineConfig({root,server:{host:'127.0.0.1',strictPort:true,
 port:Number(process.env.FRONTEND_EQ_PORT || 5202),
 proxy:{'/api':{target:'http://127.0.0.1:8032',changeOrigin:true}}}});
