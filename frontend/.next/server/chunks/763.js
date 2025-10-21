"use strict";exports.id=763,exports.ids=[763],exports.modules={8763:(e,r,t)=>{t.d(r,{Z:()=>createLucideIcon});var o=t(404),s={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v0.294.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let toKebabCase=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase().trim(),createLucideIcon=(e,r)=>{let t=(0,o.forwardRef)(({color:t="currentColor",size:i=24,strokeWidth:a=2,absoluteStrokeWidth:c,className:d="",children:n,...l},u)=>(0,o.createElement)("svg",{ref:u,...s,width:i,height:i,stroke:t,strokeWidth:c?24*Number(a)/Number(i):a,className:["lucide",`lucide-${toKebabCase(e)}`,d].join(" "),...l},[...r.map(([e,r])=>(0,o.createElement)(e,r)),...Array.isArray(n)?n:[n]]));return t.displayName=`${e}`,t}}};