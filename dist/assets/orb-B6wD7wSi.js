const J={color:"#F4F4F5",eye:"#09090B"},Q={color:"#18181B",eye:"#F4F4F5"},Z=3e3,x={x:0,y:.08},$=`
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`,ee=`
precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_look;
uniform float u_blink;
uniform vec3 u_body;
uniform vec3 u_eye;
vec3 orient(vec3 p, vec2 look) {
  float yaw = look.x * 0.92;
  float pitch = -look.y * 0.78;
  float cy = cos(yaw), sy = sin(yaw), cp = cos(pitch), sp = sin(pitch);
  vec3 q = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
  return vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
}
float eyeMask(vec3 n, vec3 e, vec3 right, vec3 up, float halfH, float rad) {
  float facing = dot(n, e);
  float x = dot(n, right) - dot(e, right);
  float y = dot(n, up) - dot(e, up);
  y -= clamp(y, -halfH, halfH);
  float d = length(vec2(x, y)) - rad;
  float fill = 1.0 - smoothstep(-0.01, 0.01, d);
  return fill * smoothstep(0.12, 0.32, facing);
}
void main() {
  vec2 uv = (gl_FragCoord.xy / u_resolution.xy) * 2.0 - 1.0;
  uv.x *= u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = uv / 0.94;
  float r2 = dot(p, p);
  float edge = 1.0 - smoothstep(0.985, 1.012, sqrt(max(r2, 0.0)));
  if (edge <= 0.001) { gl_FragColor = vec4(0.0); return; }
  vec3 n = normalize(vec3(p, sqrt(max(1.0 - r2, 0.0))));
  vec2 look = u_look;
  float lm = length(look);
  if (lm > 1.0) look /= lm;
  vec3 right = orient(vec3(1.0, 0.0, 0.0), look);
  vec3 up = orient(vec3(0.0, 1.0, 0.0), look);
  vec3 eL = orient(normalize(vec3(-0.32, 0.08, 1.0)), look);
  vec3 eR = orient(normalize(vec3(0.32, 0.08, 1.0)), look);
  float halfH = mix(0.128, 0.012, u_blink);
  float rad = mix(0.054, 0.062, u_blink);
  float eyes = max(eyeMask(n, eL, right, up, halfH, rad), eyeMask(n, eR, right, up, halfH, rad));
  gl_FragColor = vec4(clamp(mix(u_body, u_eye, clamp(eyes, 0.0, 1.0)), 0.0, 1.0), edge);
}
`,te=()=>document.documentElement.dataset.theme!=="light";function X(t){const e=parseInt(t.replace("#",""),16);return[(e>>16&255)/255,(e>>8&255)/255,(e&255)/255]}function j(t,e,u){const n=t.createShader(e);return t.shaderSource(n,u),t.compileShader(n),t.getShaderParameter(n,t.COMPILE_STATUS)?n:(t.deleteShader(n),null)}function oe(t){const e=t.getContext("webgl",{alpha:!0,antialias:!1,depth:!1,stencil:!1,premultipliedAlpha:!1});if(!e)return null;let u,n,l,A,f={},m=!1,h=!1,i=0,E=!0;const d={...x},k={...x},w={...x};let p=0,s=0,R=1800+Math.random()*2400,S=-1e4,B=600+Math.random()*900,T=-1/0,F=0;const C=()=>{if(u=j(e,e.VERTEX_SHADER,$),n=j(e,e.FRAGMENT_SHADER,ee),!u||!n||(l=e.createProgram(),e.attachShader(l,u),e.attachShader(l,n),e.linkProgram(l),!e.getProgramParameter(l,e.LINK_STATUS)))return!1;e.useProgram(l),A=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,A),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),e.STATIC_DRAW);const o=e.getAttribLocation(l,"a_position");e.enableVertexAttribArray(o),e.vertexAttribPointer(o,2,e.FLOAT,!1,0,0);for(const r of["u_resolution","u_look","u_blink","u_body","u_eye"])f[r]=e.getUniformLocation(l,r);return e.enable(e.BLEND),e.blendFunc(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA),e.viewport(0,0,t.width,t.height),!0};if(!C())return null;const H=()=>{const o=t.parentElement;if(!o)return!1;const r=Math.min(window.devicePixelRatio||1,2),a=Math.max(1,Math.floor(o.clientWidth*r)),c=Math.max(1,Math.floor(o.clientHeight*r));return o.clientWidth<=0||a===t.width&&c===t.height?!1:(t.width=a,t.height=c,e.viewport(0,0,a,c),!0)},P=matchMedia("(prefers-reduced-motion: reduce)"),q=()=>E&&!P.matches&&document.visibilityState!=="hidden"&&document.hasFocus(),v=()=>{i||h||m||(p=performance.now(),i=requestAnimationFrame(g))},I=()=>{h||m||(cancelAnimationFrame(i),i=0,p=performance.now(),F=0,g(p))},O=o=>{var a;const r=(a=t.parentElement)==null?void 0:a.getBoundingClientRect();!r||r.width<=0||(k.x=Math.max(-1,Math.min(1,(o.clientX-(r.left+r.width/2))/(window.innerWidth/2))),k.y=Math.max(-1,Math.min(1,(r.top+r.height/2-o.clientY)/(window.innerHeight/2))),T=performance.now(),E&&v())};addEventListener("pointermove",O,{passive:!0});function g(o){if(i=0,m)return;if(t.width<120&&o-F<30&&q()){i=requestAnimationFrame(g);return}F=o;const a=Math.min(50,Math.max(0,o-p));p=o;const c=q();c&&(s+=a);const L=P.matches,M=o-T<Z;if(!M&&c&&s>=B){const Y=Math.random()<.3;w.x=Y?0:(Math.random()*2-1)*.8,w.y=Y?.08:(Math.random()*2-1)*.5,B=s+900+Math.random()*2100}const G=M?k:L?x:w,K=c?M?.16:.1:1;d.x+=(G.x-d.x)*K,d.y+=(G.y-d.y)*K,!L&&s>=R&&(S=s,R=s+2200+Math.random()*3800);const y=(s-S)/1e3;let b=0;L||(y<.055?b=y/.055:y<.1?b=1:y<.18&&(b=1-(y-.1)/.08));const V=te()?J:Q;e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),e.uniform2f(f.u_resolution,t.width,t.height),e.uniform2f(f.u_look,d.x,d.y),e.uniform1f(f.u_blink,b),e.uniform3f(f.u_body,...X(V.color)),e.uniform3f(f.u_eye,...X(V.eye)),e.drawArrays(e.TRIANGLES,0,6),c&&!h&&(i=requestAnimationFrame(g))}const z=new ResizeObserver(()=>{H()&&I()});t.parentElement&&z.observe(t.parentElement);const D=new IntersectionObserver(([o])=>{E=(o==null?void 0:o.isIntersecting)??!0,v()});D.observe(t);const _=()=>v();document.addEventListener("visibilitychange",_),addEventListener("focus",_);const U=new MutationObserver(I);U.observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme"]});const W=o=>{o.preventDefault(),m=!0,cancelAnimationFrame(i),i=0,t.style.visibility="hidden"},N=()=>{h||!C()||(m=!1,t.style.visibility="",v())};return t.addEventListener("webglcontextlost",W),t.addEventListener("webglcontextrestored",N),H(),v(),{destroy(){var o;h=!0,cancelAnimationFrame(i),z.disconnect(),D.disconnect(),U.disconnect(),document.removeEventListener("visibilitychange",_),removeEventListener("focus",_),removeEventListener("pointermove",O),t.removeEventListener("webglcontextlost",W),t.removeEventListener("webglcontextrestored",N),e.deleteProgram(l),e.deleteShader(u),e.deleteShader(n),e.deleteBuffer(A),(o=e.getExtension("WEBGL_lose_context"))==null||o.loseContext()}}}export{oe as createLiveOrb};
