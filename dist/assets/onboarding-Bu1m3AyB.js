import{l as $}from"./icon-B3EXPyEE.js";const A=[["light","Light"],["dark","Dark"],["system","System"]],E=t=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.trim()),f=t=>String(t).replace(/[&<>"]/g,o=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[o]),x=matchMedia("(prefers-color-scheme: dark)"),S=t=>{try{localStorage.setItem("theme",t)}catch{}document.documentElement.dataset.theme=t==="system"?x.matches?"dark":"light":t};function N(){const t={email:"",name:"",theme:"light",sendErrors:!0,shareChats:!1,autostart:!0,sent:!0};let o=0,r=!1;const n=document.createElement("div");n.className="ob",n.setAttribute("role","dialog"),n.setAttribute("aria-modal","true"),n.setAttribute("aria-labelledby","ob-title"),n.innerHTML=`
    <div class="ob-drag">
      <span class="ob-ctl">
        <button type="button" data-w="min" aria-label="Minimize"><svg viewBox="0 0 10 10"><path d="M1.5 5h7"/></svg></button>
        <button type="button" data-w="close" aria-label="Close"><svg viewBox="0 0 10 10"><path d="m2 2 6 6m0-6-6 6"/></svg></button>
      </span>
    </div>
    <div class="ob-card">
      <div class="ob-progress" aria-hidden="true">${"<i></i>".repeat(4)}</div>
      <div class="ob-stage"></div>
      <div class="ob-foot">
        <button type="button" class="ob-btn ob-back">Back</button>
        <span class="ob-count" aria-live="polite"></span>
        <button type="button" class="ob-btn ob-next">Next</button>
      </div>
    </div>`,document.body.append(n);const i=e=>n.querySelector(e),p=i(".ob-stage"),g=i(".ob-back"),d=i(".ob-next");n.querySelectorAll("[data-w]").forEach(e=>{e.onclick=()=>window.api.win(e.dataset.w)});const b=(e,a,s)=>`${e?`<p class="ob-kicker">${e}</p>`:""}<h1 id="ob-title">${a}</h1><p class="ob-sub">${s}</p>`,u=[{html:()=>`<img class="ob-logo" src="${$}" alt="" />${b("Welcome to Genisys","Create your account","Just your email. No password, no spam. It lets me count who uses Genisys and reply when you send a report. Basic PC specs (Windows version, CPU, RAM) are shared too, so it runs well on your PC.")}
        <label class="ob-label" for="ob-email">Email</label>
        <input id="ob-email" class="ob-input" type="email" autocomplete="email" placeholder="you@example.com" value="${f(t.email)}" />
        <p class="ob-err" id="ob-email-err" hidden>That doesn't look like an email address yet.</p>`,bind:()=>{const e=i("#ob-email");return e.oninput=()=>{t.email=e.value,i("#ob-email-err").hidden=!0,h()},e},valid:()=>E(t.email),invalid:()=>{i("#ob-email-err").hidden=!1,i("#ob-email").focus()}},{html:()=>`${b("","What should Genisys call you?","It uses your name when it talks to you. You can skip this.")}
        <label class="ob-label" for="ob-name">Your name</label>
        <input id="ob-name" class="ob-input" type="text" autocomplete="given-name" maxlength="60" placeholder="e.g. Kevin" value="${f(t.name)}" />`,bind:()=>{const e=i("#ob-name");return e.oninput=()=>{t.name=e.value,h()},e},label:()=>t.name.trim()?"Next":"Skip"},{html:()=>`${b("","Pick your look","You can switch any time with ◐ in the title bar.")}
        <div class="ob-themes" role="radiogroup" aria-label="Theme">${A.map(([e,a])=>`
          <button type="button" role="radio" class="ob-theme t-${e}" data-v="${e}" aria-checked="${t.theme===e}">
            <span class="ob-prev" aria-hidden="true"><i></i><b></b><b></b><b></b></span><span>${a}${e==="light"?" <small>default</small>":""}</span>
          </button>`).join("")}</div>`,bind:()=>{const e=[...n.querySelectorAll(".ob-theme")],a=s=>{t.theme=s,S(s),e.forEach(l=>l.setAttribute("aria-checked",l.dataset.v===s))};return e.forEach((s,l)=>{s.onclick=()=>a(s.dataset.v),s.onkeydown=c=>{const k={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[c.key];if(k){c.preventDefault();const v=e[(l+k+e.length)%e.length];a(v.dataset.v),v.focus()}}}),e.find(s=>s.dataset.v===t.theme)}},{html:()=>`${b("","Quick settings","Change them later in Settings.")}
        ${[["sendErrors","Send error reports","When something breaks, send the error message and app version so it gets fixed. Your user folder and name are removed first."],["shareChats","Share conversations","Send what you ask and what Genisys answers so it learns what to get better at. No files or passwords; your folder and name are removed."],["autostart","Start with Windows","Genisys waits quietly in the background, so Alt+Space works right after you sign in."]].map(([e,a,s])=>`
          <div class="ob-switch-row">
            <span><b id="ob-l-${e}">${a}</b><small>${s}</small></span>
            <button type="button" role="switch" class="ob-switch" data-k="${e}" aria-checked="${t[e]}" aria-labelledby="ob-l-${e}"><i></i></button>
          </div>`).join("")}`,bind:()=>{const e=[...n.querySelectorAll(".ob-switch")];return e.forEach(a=>{a.onclick=()=>{t[a.dataset.k]=!t[a.dataset.k],a.setAttribute("aria-checked",t[a.dataset.k])}}),e[0]},label:()=>"Finish",finish:async()=>{const e=t.name.trim(),a=await window.api.cloud("register",{email:t.email,name:e,theme:t.theme,sendErrors:t.sendErrors,shareChats:t.shareChats}).catch(()=>({sent:!1}));t.sent=a.sent,await window.api.autostart(t.autostart).catch(()=>{}),e&&await window.api.db("addProfile","fact",`My name is ${e}`).catch(()=>{})}},{html:()=>`<img class="ob-logo big" src="${$}" alt="" />${b("",`You're all set${t.name.trim()?`, ${f(t.name.trim())}`:""}!`,"Type what you want and Genisys does it. A few keys worth knowing:")}
        <ul class="ob-keys">
          <li><span><kbd>Alt</kbd><kbd>Space</kbd></span>Command bar over any app</li>
          <li><span><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>N</kbd></span>New agent window</li>
          <li><span><kbd>/</kbd></span>Actions like /agent 3 and /browser</li>
          <li><span><kbd>F1</kbd></span>All shortcuts and help</li>
        </ul>
        ${t.sent?"":'<p class="ob-note">You seem to be offline, so your account will be created the next time Genisys starts with internet.</p>'}`,bind:()=>d,label:()=>"Start using Genisys"}],m=u.length-1;function h(){var a;const e=u[o];d.textContent=r?"Saving…":((a=e.label)==null?void 0:a.call(e))??"Next",d.disabled=r,d.classList.toggle("dim",!!e.valid&&!e.valid()),g.style.visibility=o===0||o===m||r?"hidden":"visible",i(".ob-count").textContent=o===m?"":`Step ${o+1} of ${m}`,n.querySelectorAll(".ob-progress i").forEach((s,l)=>s.classList.toggle("on",l<=o))}function y(e,a){o=e,p.className=`ob-stage ${a>0?"in-next":"in-back"}`,p.innerHTML=u[o].html(),p.offsetWidth;const s=u[o].bind();h(),s==null||s.focus()}async function w(){var a;const e=u[o];if(!r){if(e.valid&&!e.valid()){(a=e.invalid)==null||a.call(e);return}if(o===m){n.classList.add("out"),setTimeout(()=>{var s;n.remove(),(s=document.getElementById("input"))==null||s.focus()},300);return}e.finish&&(r=!0,h(),await e.finish(),r=!1),y(o+1,1)}}d.onclick=w,g.onclick=()=>{o>0&&!r&&y(o-1,-1)},n.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.tagName==="INPUT"&&(e.preventDefault(),w()),e.key==="Tab"){const a=[...n.querySelectorAll("button, input")].filter(c=>!c.disabled&&c.offsetParent!==null&&getComputedStyle(c).visibility!=="hidden"),[s,l]=[a[0],a[a.length-1]];e.shiftKey&&document.activeElement===s?(e.preventDefault(),l.focus()):!e.shiftKey&&document.activeElement===l&&(e.preventDefault(),s.focus())}}),S(t.theme),y(0,1)}export{N as startOnboarding};
