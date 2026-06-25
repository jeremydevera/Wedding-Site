// AUTO-GENERATED from the falling-effects gallery. Do not edit by hand.
// 14 home-decoration effects: scoped CSS + per-effect mount(stage) builders.

export const FX_LIST = [
  { id: "petals", title: "Petals (refined)" },
  { id: "butterflies", title: "Butterflies" },
  { id: "sakura", title: "Cherry blossom" },
  { id: "hearts", title: "Hearts (refined)" },
  { id: "confetti", title: "Confetti (refined)" },
  { id: "lavender", title: "Lavender" },
  { id: "bubbles", title: "Bubbles (refined)" },
  { id: "bokeh", title: "Bokeh glow" },
  { id: "feathers", title: "Feathers" },
  { id: "lanterns", title: "Paper lanterns" },
  { id: "ribbons", title: "Ribbons" },
  { id: "autumn", title: "Autumn leaves" },
  { id: "dandelion", title: "Dandelion" },
  { id: "musicnotes", title: "Music notes" },
];

export const FX_CSS = `
/* ===== petals : Rose Petals ===== */
.fx-petals .petal{
  position:absolute;
  top:0;
  left:0;
  width:var(--w);
  height:var(--h);
  border-radius:75% 75% 70% 70% / 90% 90% 60% 60%;
  background:
    radial-gradient(120% 80% at 35% 25%, rgba(255,255,255,.55), rgba(255,255,255,0) 45%),
    radial-gradient(130% 110% at 60% 75%, var(--c2), var(--c1) 70%);
  box-shadow: inset 0 -2px 4px rgba(201,111,125,.35);
  filter: drop-shadow(0 1px 2px rgba(120,60,70,.35));
  transform: translate3d(var(--x), -40px, 0) rotateZ(0deg);
  will-change: transform, opacity;
  animation-name: petals-tumble;
  animation-timing-function: cubic-bezier(.45,.05,.55,.95);
  animation-iteration-count: infinite;
}
.fx-petals .petal::after{
  content:"";
  position:absolute;
  inset:0;
  border-radius:inherit;
  background: linear-gradient(115deg, rgba(255,255,255,.4), rgba(255,255,255,0) 40%);
  opacity:.6;
}
@keyframes petals-tumble{
  0%{
    transform: translate3d(var(--x), -40px, 0) rotateY(0deg) rotateZ(var(--r0));
    opacity:0;
  }
  8%{ opacity:.95; }
  50%{
    transform: translate3d(calc(var(--x) + var(--drift)), calc(var(--travel) * .5), 0) rotateY(180deg) rotateZ(calc(var(--r0) + 140deg));
  }
  92%{ opacity:.95; }
  100%{
    transform: translate3d(calc(var(--x) + var(--drift) * 1.6), var(--travel), 0) rotateY(360deg) rotateZ(calc(var(--r0) + 300deg));
    opacity:0;
  }
}


/* ===== butterflies : Butterflies ===== */
.fx-butterflies .bfly{position:absolute;top:0;left:0;width:var(--w);height:var(--w);transform:translate3d(var(--x0),var(--y0),0);will-change:transform;animation:butterflies-roam var(--dur) ease-in-out infinite;}
.fx-butterflies .bfly .wings{position:absolute;inset:0;animation:butterflies-bob calc(var(--dur)*0.18) ease-in-out infinite;}
.fx-butterflies .wing{position:absolute;top:12%;width:46%;height:76%;background:radial-gradient(120% 90% at 50% 20%,#fff6e0 0%,#e6d3a3 38%,#caa45a 78%,#7a5b2e 100%);filter:drop-shadow(0 1px 2px rgba(80,60,30,.45));will-change:transform;}
.fx-butterflies .wing::after{content:"";position:absolute;border-radius:50%;width:34%;height:30%;left:33%;top:24%;background:rgba(122,91,46,.35);}
.fx-butterflies .wing.l{left:4%;border-radius:80% 30% 70% 40% / 90% 60% 50% 70%;transform-origin:right center;animation:butterflies-flapL calc(var(--flap)) ease-in-out infinite;}
.fx-butterflies .wing.r{right:4%;border-radius:30% 80% 40% 70% / 60% 90% 70% 50%;transform-origin:left center;animation:butterflies-flapR calc(var(--flap)) ease-in-out infinite;}
.fx-butterflies .body{position:absolute;left:48%;top:14%;width:4%;height:72%;border-radius:40%;background:linear-gradient(#3a2c14,#7a5b2e);}
@keyframes butterflies-roam{0%{transform:translate3d(var(--x0),var(--y0),0) rotate(var(--r0));}20%{transform:translate3d(var(--x1),var(--y1),0) rotate(var(--r1));}40%{transform:translate3d(var(--x2),var(--y2),0) rotate(var(--r2));}60%{transform:translate3d(var(--x3),var(--y3),0) rotate(var(--r3));}80%{transform:translate3d(var(--x4),var(--y4),0) rotate(var(--r1));}100%{transform:translate3d(var(--x0),var(--y0),0) rotate(var(--r0));}}
@keyframes butterflies-bob{0%,100%{transform:translateY(0);}50%{transform:translateY(-8%);}}
@keyframes butterflies-flapL{0%,100%{transform:rotateY(15deg) scaleX(1);}50%{transform:rotateY(78deg) scaleX(.3);}}
@keyframes butterflies-flapR{0%,100%{transform:rotateY(-15deg) scaleX(1);}50%{transform:rotateY(-78deg) scaleX(.3);}}


/* ===== sakura : Cherry Blossom ===== */
.fx-sakura .petal{position:absolute;top:0;left:0;width:14px;height:14px;will-change:transform,opacity;transform:translate3d(0,-40px,0);filter:drop-shadow(0 1px 2px rgba(120,70,90,.32));animation-name:sakura-fall;animation-timing-function:cubic-bezier(.45,.05,.55,.95);animation-iteration-count:infinite}
.fx-sakura .petal i{position:absolute;inset:0;display:block;background:radial-gradient(120% 120% at 30% 25%,#ffeaf1 0%,#fbd6e0 42%,#f7a8c0 78%,#e88aa8 100%);border-radius:100% 0 100% 0;animation-name:sakura-flutter;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}
.fx-sakura .petal i::after{content:"";position:absolute;top:-2px;left:50%;width:5px;height:5px;background:inherit;border-radius:50% 0 50% 0;transform:translateX(-50%) rotate(45deg)}
.fx-sakura .petal.p2 i{background:radial-gradient(120% 120% at 30% 25%,#ffeaf1 0%,#f7a8c0 60%,#e88aa8 100%)}
@keyframes sakura-fall{0%{transform:translate3d(0,-40px,0) rotate(0deg);opacity:0}8%{opacity:.95}50%{transform:translate3d(var(--drift,20px),calc(var(--travel)*.5),0) rotate(180deg)}92%{opacity:.95}100%{transform:translate3d(calc(var(--drift,20px)*-1),var(--travel),0) rotate(360deg);opacity:0}}
@keyframes sakura-flutter{0%{transform:rotateY(0deg) rotate(-12deg) scale(var(--sc,1))}100%{transform:rotateY(150deg) rotate(14deg) scale(var(--sc,1))}}


/* ===== hearts : Floating Hearts ===== */
.fx-hearts .heart{
  position:absolute;
  top:0;
  left:0;
  width:var(--size);
  height:var(--size);
  transform:translate3d(var(--x), -40px, 0) rotate(-45deg) scale(.6);
  opacity:0;
  will-change:transform, opacity;
  filter:drop-shadow(0 1px 2px rgba(90,60,55,.35));
  animation:hearts-fall var(--dur) linear infinite, hearts-pulse calc(var(--dur)/4) ease-in-out infinite alternate;
}
.fx-hearts .heart::before,
.fx-hearts .heart::after{
  content:"";
  position:absolute;
  width:100%;
  height:100%;
  border-radius:50% 50% 0 0;
  background:var(--c1);
  background:radial-gradient(circle at 32% 30%, var(--c2), var(--c1));
}
.fx-hearts .heart::before{ left:50%; }
.fx-hearts .heart::after{ top:-50%; }
@keyframes hearts-fall{
  0%   { transform:translate3d(var(--x), -40px, 0) rotate(-45deg); opacity:0; }
  12%  { opacity:var(--peak); }
  85%  { opacity:var(--peak); }
  100% { transform:translate3d(calc(var(--x) + var(--drift)), var(--travel), 0) rotate(-45deg); opacity:0; }
}
@keyframes hearts-pulse{
  0%   { scale:.92; }
  100% { scale:1.08; }
}


/* ===== confetti : Confetti ===== */
.fx-confetti{ background:transparent; }
.fx-confetti .cf{
  position:absolute;
  top:0;
  left:0;
  width:8px;
  height:14px;
  border-radius:1px;
  transform-style:preserve-3d;
  will-change:transform,opacity;
  box-shadow:0 1px 2px rgba(70,60,30,.35);
  animation-name:confetti-fall;
  animation-timing-function:linear;
  animation-iteration-count:infinite;
}
.fx-confetti .cf-c0{ background:#6f7444; }
.fx-confetti .cf-c1{ background:#caa45a; }
.fx-confetti .cf-c2{ background:#d98b96; }
.fx-confetti .cf-c3{ background:#8fb0c9; }
.fx-confetti .cf-c4{ background:#ffffff; box-shadow:0 1px 2px rgba(70,60,30,.45); }
@keyframes confetti-fall{
  0%{
    transform:translate3d(0, var(--start), 0) rotateZ(0deg) rotateX(0deg);
    opacity:0;
  }
  8%{ opacity:1; }
  92%{ opacity:1; }
  100%{
    transform:translate3d(var(--drift), var(--end), 0) rotateZ(var(--rz)) rotateX(var(--rx));
    opacity:.85;
  }
}


/* ===== lavender : Lavender Drift ===== */
.fx-lavender .bud{position:absolute;top:0;left:0;width:var(--w);height:var(--h);transform:translate3d(var(--x),-40px,0);will-change:transform,opacity;animation:lavender-fall var(--dur) linear infinite;}
.fx-lavender .bud .floret{position:absolute;left:0;top:0;width:100%;height:100%;will-change:transform;animation:lavender-sway var(--sway) ease-in-out infinite alternate;}
.fx-lavender .bud .floret::before,.fx-lavender .bud .floret::after,.fx-lavender .bud .floret .b{position:absolute;left:50%;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;background:radial-gradient(circle at 38% 32%,var(--c1),var(--c2) 70%);filter:drop-shadow(0 1px 1.5px rgba(60,48,90,.45));}
.fx-lavender .bud .floret::before{content:"";top:0;width:46%;height:42%;transform:translateX(-50%);}
.fx-lavender .bud .floret::after{content:"";top:24%;left:24%;width:40%;height:38%;transform:none;background:radial-gradient(circle at 40% 32%,var(--c3),var(--c2) 72%);}
.fx-lavender .bud .floret .b{top:24%;right:14%;left:auto;width:40%;height:38%;background:radial-gradient(circle at 40% 32%,var(--c3),var(--c4) 75%);}
.fx-lavender .bud .floret .c{position:absolute;left:50%;top:44%;width:38%;height:40%;transform:translateX(-50%);border-radius:50% 50% 50% 50%/55% 55% 45% 45%;background:radial-gradient(circle at 42% 34%,var(--c1),var(--c4) 78%);filter:drop-shadow(0 1px 1.5px rgba(60,48,90,.45));}
.fx-lavender .bud .stem{position:absolute;left:50%;bottom:-30%;width:2px;height:34%;transform:translateX(-50%);background:linear-gradient(to bottom,var(--c2),rgba(111,94,149,0));border-radius:2px;}
@keyframes lavender-fall{0%{transform:translate3d(var(--x),-40px,0) rotate(var(--r0));opacity:0;}8%{opacity:var(--op);}90%{opacity:var(--op);}100%{transform:translate3d(calc(var(--x) + var(--drift)),var(--travel),0) rotate(var(--r1));opacity:0;}}
@keyframes lavender-sway{0%{transform:translateX(calc(var(--amp) * -1)) rotate(-7deg);}100%{transform:translateX(var(--amp)) rotate(7deg);}}


/* ===== bubbles : Soap Bubbles ===== */
.fx-bubbles{ background: transparent; }
.fx-bubbles .bub{
  position:absolute;
  bottom:0;
  left:0;
  width:var(--size);
  height:var(--size);
  border-radius:50%;
  background:
    radial-gradient(circle at 32% 28%, rgba(255,255,255,.95) 0 8%, rgba(255,255,255,0) 26%),
    radial-gradient(circle at 68% 72%, rgba(243,214,218,.55) 0 18%, rgba(243,214,218,0) 42%),
    radial-gradient(circle at 50% 50%, rgba(232,224,240,.30) 0 55%, rgba(207,232,240,.40) 78%, rgba(255,255,255,.10) 100%);
  box-shadow:
    inset 0 0 8px rgba(255,255,255,.6),
    inset -3px -4px 10px rgba(207,232,240,.5),
    0 1px 3px rgba(70,90,110,.28);
  border:1px solid rgba(255,255,255,.45);
  opacity:0;
  will-change:transform,opacity;
  transform:translate3d(0,0,0);
  animation:bubbles-rise var(--dur) linear infinite, bubbles-wobble var(--wdur) ease-in-out infinite;
}
@keyframes bubbles-rise{
  0%{ transform:translate3d(var(--x),0,0) scale(var(--s)); opacity:0; }
  8%{ opacity:var(--op); }
  88%{ opacity:var(--op); }
  100%{ transform:translate3d(var(--x),calc(-1 * var(--travel)),0) scale(var(--s)); opacity:0; }
}
@keyframes bubbles-wobble{
  0%{ margin-left:0; }
  50%{ margin-left:var(--drift); }
  100%{ margin-left:0; }
}


/* ===== bokeh : Dreamy Bokeh ===== */
.fx-bokeh{background:transparent;}
.fx-bokeh .orb{
  position:absolute;
  top:0;left:0;
  border-radius:50%;
  filter:blur(7px);
  opacity:0;
  will-change:transform,opacity;
  mix-blend-mode:screen;
  box-shadow:0 0 1px rgba(120,100,60,.25);
  animation-name:bokeh-drift;
  animation-timing-function:ease-in-out;
  animation-iteration-count:infinite;
}
@keyframes bokeh-drift{
  0%{transform:translate3d(var(--x0),var(--y0),0) scale(var(--s0));opacity:0;}
  15%{opacity:var(--op);}
  33%{transform:translate3d(var(--x1),var(--y1),0) scale(var(--s1));opacity:var(--op);}
  66%{transform:translate3d(var(--x2),var(--y2),0) scale(var(--s2));opacity:var(--op);}
  85%{opacity:var(--op);}
  100%{transform:translate3d(var(--x0),var(--y0),0) scale(var(--s0));opacity:0;}
}


/* ===== feathers : Soft Feathers ===== */
.fx-feathers .feather{position:absolute;top:0;left:0;width:13px;height:38px;will-change:transform;transform:translate3d(0,-60px,0);animation:feathers-fall var(--dur,9s) linear infinite;filter:drop-shadow(0 2px 2px rgba(90,80,55,.32));}
.fx-feathers .feather .vane{position:absolute;inset:0;border-radius:60% 60% 50% 50% / 80% 80% 20% 20%;background:linear-gradient(160deg,#fff8ef 0%,#ece3cf 45%,#d8cbb0 75%,#b8ab90 100%);}
.fx-feathers .feather .vane::before{content:"";position:absolute;inset:0;border-radius:inherit;background:repeating-linear-gradient(118deg,rgba(184,171,144,.0) 0px,rgba(184,171,144,.0) 2px,rgba(184,171,144,.28) 2px,rgba(184,171,144,.28) 3px);opacity:.55;}
.fx-feathers .feather .quill{position:absolute;left:50%;top:6%;width:1.4px;height:92%;transform:translateX(-50%);background:linear-gradient(to bottom,rgba(120,108,80,.0),rgba(120,108,80,.6) 30%,rgba(120,108,80,.35));border-radius:1px;}
.fx-feathers .sway{display:block;width:100%;height:100%;animation:feathers-sway var(--sway,4s) ease-in-out infinite;transform-origin:50% 0%;}
.fx-feathers .spin{display:block;width:100%;height:100%;animation:feathers-spin var(--spin,7s) ease-in-out infinite;}
@keyframes feathers-fall{from{transform:translate3d(0,-60px,0)}to{transform:translate3d(var(--drift,0px),var(--travel,600px),0)}}
@keyframes feathers-sway{0%,100%{transform:rotate(calc(var(--swA,16deg) * -1))}50%{transform:rotate(var(--swA,16deg))}}
@keyframes feathers-spin{0%{transform:rotate(var(--rot,0deg))}100%{transform:rotate(calc(var(--rot,0deg) + var(--rotEnd,40deg)))}}


/* ===== lanterns : Paper Lanterns ===== */
.fx-lanterns{background:linear-gradient(180deg,#1a1726 0%,#2c2438 55%,#3a2f3e 100%);}
.fx-lanterns .lantern{position:absolute;bottom:0;left:0;will-change:transform,opacity;transform:translate3d(0,0,0);animation:lanterns-rise var(--dur) linear infinite;}
.fx-lanterns .body{position:relative;width:var(--w);height:var(--h);border-radius:46% 46% 44% 44%/52% 52% 48% 48%;background:radial-gradient(60% 55% at 50% 42%,#fff1cf 0%,#ffcf6b 42%,#ff9e57 78%,#b8902e 100%);box-shadow:0 0 14px 6px rgba(255,177,90,.55),0 0 30px 12px rgba(255,158,87,.28);animation:lanterns-glow var(--gdur) ease-in-out infinite alternate;}
.fx-lanterns .body::before{content:"";position:absolute;left:50%;top:-3px;width:42%;height:5px;transform:translateX(-50%);border-radius:3px;background:#3a2f1e;opacity:.7;}
.fx-lanterns .body::after{content:"";position:absolute;left:50%;bottom:-4px;width:34%;height:5px;transform:translateX(-50%);border-radius:0 0 3px 3px;background:linear-gradient(#b8902e,#7a5e1e);opacity:.85;}
.fx-lanterns .sway{display:block;animation:lanterns-sway var(--sdur) ease-in-out infinite alternate;}
@keyframes lanterns-rise{0%{transform:translate3d(0,0,0);opacity:0;}8%{opacity:1;}88%{opacity:1;}100%{transform:translate3d(0,calc(var(--travel) * -1),0);opacity:0;}}
@keyframes lanterns-sway{0%{transform:translateX(calc(var(--drift) * -1)) rotate(-3deg);}100%{transform:translateX(var(--drift)) rotate(3deg);}}
@keyframes lanterns-glow{0%{opacity:.82;}100%{opacity:1;}}


/* ===== ribbons : Ribbon Streamers ===== */
.fx-ribbons{}
.fx-ribbons .ribbon{
  position:absolute;
  top:0;
  left:0;
  width:var(--w);
  height:var(--h);
  transform-style:preserve-3d;
  will-change:transform;
  transform:translate3d(var(--x), -80px, 0);
  animation:ribbons-fall var(--dur) linear infinite;
  animation-delay:var(--delay);
}
.fx-ribbons .ribbon .strip{
  position:absolute;
  inset:0;
  border-radius:40% 60% 45% 55% / 50%;
  background:linear-gradient(90deg,
    rgba(255,255,255,.45) 0%,
    var(--c) 30%,
    var(--c2) 70%,
    rgba(0,0,0,.18) 100%);
  box-shadow:0 1px 2px rgba(70,60,30,.32);
  transform-origin:50% 0;
  animation:ribbons-twist var(--twist) ease-in-out infinite;
  animation-delay:var(--delay);
}

@keyframes ribbons-fall{
  0%{ transform:translate3d(var(--x), -80px, 0) rotate(var(--r0)); }
  50%{ transform:translate3d(calc(var(--x) + var(--drift)), calc(var(--travel) * 0.5), 0) rotate(var(--r1)); }
  100%{ transform:translate3d(var(--x), var(--travel), 0) rotate(var(--r0)); }
}
@keyframes ribbons-twist{
  0%{ transform:rotateY(0deg) skewX(0deg) scaleX(1); }
  25%{ transform:rotateY(160deg) skewX(8deg) scaleX(.55); }
  50%{ transform:rotateY(360deg) skewX(0deg) scaleX(1); }
  75%{ transform:rotateY(540deg) skewX(-8deg) scaleX(.55); }
  100%{ transform:rotateY(720deg) skewX(0deg) scaleX(1); }
}

/* ===== autumn : Autumn Leaves ===== */
.fx-autumn .leaf{
  position:absolute;
  top:0;
  left:0;
  width:var(--sz);
  height:var(--sz);
  will-change:transform,opacity;
  transform:translate3d(var(--x),-40px,0);
  filter:drop-shadow(0 1px 2px rgba(70,40,15,.4));
  animation:autumn-fall var(--dur) linear infinite;
}
.fx-autumn .leaf .blade{
  position:absolute;
  inset:0;
  border-radius:8% 8% 8% 8%;
  background:radial-gradient(120% 120% at 50% 10%, var(--c1) 0%, var(--c2) 60%, var(--c3) 100%);
  clip-path:polygon(50% 0%, 60% 22%, 80% 14%, 70% 38%, 96% 38%, 74% 54%, 90% 78%, 62% 68%, 56% 98%, 50% 80%, 44% 98%, 38% 68%, 10% 78%, 26% 54%, 4% 38%, 30% 38%, 20% 14%, 40% 22%);
  animation:autumn-tumble var(--tdur) ease-in-out infinite;
}
.fx-autumn .leaf .vein{
  position:absolute;
  left:50%;
  top:6%;
  width:1px;
  height:78%;
  margin-left:-.5px;
  background:linear-gradient(to bottom, rgba(60,30,10,.55), rgba(60,30,10,.05));
}
@keyframes autumn-fall{
  0%{transform:translate3d(var(--x),-40px,0);opacity:0;}
  8%{opacity:1;}
  50%{transform:translate3d(calc(var(--x) + var(--drift)),calc(var(--travel) * .5),0);}
  92%{opacity:1;}
  100%{transform:translate3d(var(--x),var(--travel),0);opacity:0;}
}
@keyframes autumn-tumble{
  0%{transform:rotate(0deg) rotateY(0deg);}
  50%{transform:rotate(180deg) rotateY(160deg);}
  100%{transform:rotate(360deg) rotateY(360deg);}
}


/* ===== dandelion : Dandelion Seeds ===== */
.fx-dandelion .seed{position:absolute;top:0;left:0;width:var(--sz);height:var(--sz);transform:translate3d(var(--x),-40px,0);will-change:transform,opacity;animation:dandelion-drift var(--dur) linear var(--delay) infinite;filter:drop-shadow(0 1px 2px rgba(80,70,40,.45))}
.fx-dandelion .tuft{position:absolute;inset:0;border-radius:50%;animation:dandelion-spin var(--spin) linear var(--delay) infinite}
.fx-dandelion .tuft::before,.fx-dandelion .tuft::after{content:"";position:absolute;inset:0;border-radius:50%;background:
repeating-conic-gradient(from 0deg,#8f8468 0deg 0.9deg,transparent 0.9deg 24deg)}
.fx-dandelion .tuft::after{background:repeating-conic-gradient(from 13deg,#b3a98f 0deg 0.8deg,transparent 0.8deg 24deg);transform:scale(.82)}
.fx-dandelion .hub{position:absolute;left:50%;top:50%;width:20%;height:20%;border-radius:50%;background:radial-gradient(circle at 38% 35%,#cfc6b4,#8f8468 70%);transform:translate(-50%,-50%)}
.fx-dandelion .stem{position:absolute;left:50%;top:88%;width:5%;height:42%;border-radius:2px;background:linear-gradient(#6f6a52,#8f8468);transform:translate(-50%,0)}
.fx-dandelion .body{position:absolute;left:50%;top:128%;width:20%;height:24%;border-radius:50% 50% 50% 50%/65% 65% 35% 35%;background:radial-gradient(circle at 40% 30%,#8f8468,#6f6a52);transform:translate(-50%,0)}
@keyframes dandelion-drift{0%{transform:translate3d(var(--x),-40px,0);opacity:0}8%{opacity:1}50%{transform:translate3d(calc(var(--x) + var(--drift)),calc(var(--travel) * .5),0)}92%{opacity:1}100%{transform:translate3d(calc(var(--x) - var(--drift)),var(--travel),0);opacity:0}}
@keyframes dandelion-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}


/* ===== musicnotes : Music Notes ===== */
.fx-musicnotes .note{position:absolute;bottom:0;left:0;will-change:transform,opacity;transform:translate3d(0,0,0);animation:musicnotes-rise linear infinite;filter:drop-shadow(0 1px 2px rgba(67,65,47,.45))}
.fx-musicnotes .note .head{position:absolute;width:13px;height:10px;border-radius:60% 60% 58% 58%/70% 70% 60% 60%;transform:rotate(-22deg)}
.fx-musicnotes .note .stem{position:absolute;width:2px;height:30px;left:11px;bottom:5px;border-radius:1px}
.fx-musicnotes .note .flag{position:absolute;width:9px;height:14px;left:11px;bottom:30px;border-radius:0 80% 0 60%/0 70% 0 90%;transform:skewX(-8deg)}
.fx-musicnotes .note.beamed .head2{position:absolute;width:13px;height:10px;border-radius:60% 60% 58% 58%/70% 70% 60% 60%;transform:rotate(-22deg);left:20px}
.fx-musicnotes .note.beamed .stem2{position:absolute;width:2px;height:30px;left:31px;bottom:5px;border-radius:1px}
.fx-musicnotes .note.beamed .beam{position:absolute;width:22px;height:4px;left:11px;bottom:33px;border-radius:2px;transform:rotate(-6deg);transform-origin:left center}
@keyframes musicnotes-rise{0%{transform:translate3d(0,0,0) rotate(var(--rot0));opacity:0}8%{opacity:var(--peak)}50%{transform:translate3d(var(--sway),calc(var(--travel) * -.5),0) rotate(var(--rot1))}90%{opacity:var(--peak)}100%{transform:translate3d(calc(var(--sway) * -1),calc(var(--travel) * -1),0) rotate(var(--rot2));opacity:0}}


/* overlay overrides: effects are a transparent layer over the page */
.decor.fx{ background: transparent !important; }
.decor-preview.fx{ position: relative; overflow: hidden; background: transparent !important; }
`;

export const FX_MOUNTS = {
  "petals": function (stage) {
var W = stage.clientWidth, H = stage.clientHeight;
var palettes = [
  ['#d98b96','#e8b4bc'],
  ['#c96f7d','#e8b4bc'],
  ['#e8b4bc','#f3d6da'],
  ['#d98b96','#f3d6da']
];
var N = 22;
for (var i = 0; i < N; i++){
  var p = document.createElement('div');
  p.className = 'petal';
  var w = 12 + Math.random()*14;
  var h = w * (1.05 + Math.random()*0.25);
  var pal = palettes[(Math.random()*palettes.length)|0];
  var dur = 7 + Math.random()*6;
  var x = Math.random()*(W - w);
  var drift = (Math.random()*2 - 1) * (W*0.18);
  var travel = H + 70;
  var r0 = (Math.random()*360)|0;

  p.style.setProperty('--w', w.toFixed(1)+'px');
  p.style.setProperty('--h', h.toFixed(1)+'px');
  p.style.setProperty('--c1', pal[0]);
  p.style.setProperty('--c2', pal[1]);
  p.style.setProperty('--x', x.toFixed(1)+'px');
  p.style.setProperty('--drift', drift.toFixed(1)+'px');
  p.style.setProperty('--travel', travel+'px');
  p.style.setProperty('--r0', r0+'deg');
  p.style.opacity = (0.7 + Math.random()*0.3).toFixed(2);
  p.style.animationDuration = dur.toFixed(2)+'s';
  p.style.animationDelay = (-(Math.random()*dur)).toFixed(2)+'s';

  stage.appendChild(p);
}
  },
  "butterflies": function (stage) {
var W = stage.clientWidth, H = stage.clientHeight;
var N = 22;
for (var i = 0; i < N; i++){
  var b = document.createElement('div');
  b.className = 'bfly';
  var size = 16 + Math.random()*18;
  b.style.setProperty('--w', size + 'px');
  // five roaming waypoints kept within stage bounds, with clear up & down moves
  function pt(){ return (Math.random()*(W-size)) + 'px'; }
  function pty(){ return (Math.random()*(H-size)) + 'px'; }
  var pts = [];
  for (var p = 0; p < 5; p++){ pts.push([Math.random()*(W-size), Math.random()*(H-size)]); }
  b.style.setProperty('--x0', pts[0][0]+'px'); b.style.setProperty('--y0', pts[0][1]+'px');
  b.style.setProperty('--x1', pts[1][0]+'px'); b.style.setProperty('--y1', pts[1][1]+'px');
  b.style.setProperty('--x2', pts[2][0]+'px'); b.style.setProperty('--y2', pts[2][1]+'px');
  b.style.setProperty('--x3', pts[3][0]+'px'); b.style.setProperty('--y3', pts[3][1]+'px');
  b.style.setProperty('--x4', pts[4][0]+'px'); b.style.setProperty('--y4', pts[4][1]+'px');
  b.style.setProperty('--r0', (Math.random()*40-20)+'deg');
  b.style.setProperty('--r1', (Math.random()*40-20)+'deg');
  b.style.setProperty('--r2', (Math.random()*40-20)+'deg');
  b.style.setProperty('--r3', (Math.random()*40-20)+'deg');
  var dur = 12 + Math.random()*10;
  b.style.setProperty('--dur', dur + 's');
  b.style.setProperty('--flap', (0.28 + Math.random()*0.22) + 's');
  b.style.animationDelay = (-(Math.random()*dur)) + 's';
  var wings = document.createElement('div');
  wings.className = 'wings';
  var wl = document.createElement('div'); wl.className = 'wing l';
  var wr = document.createElement('div'); wr.className = 'wing r';
  var body = document.createElement('div'); body.className = 'body';
  wings.appendChild(wl); wings.appendChild(wr); wings.appendChild(body);
  b.appendChild(wings);
  stage.appendChild(b);
}
  },
  "sakura": function (stage) {
var H = stage.clientHeight, W = stage.clientWidth;
var N = 22;
for (var k = 0; k < N; k++){
  var p = document.createElement('div');
  p.className = 'petal' + (Math.random() < 0.5 ? ' p2' : '');
  var inner = document.createElement('i');
  p.appendChild(inner);
  var dur = 9 + Math.random() * 7;          // 9-16s slow gentle fall
  var sc = 0.55 + Math.random() * 0.9;       // varied depth/size
  var startX = Math.random() * W;
  var drift = (12 + Math.random() * 26) * (Math.random() < 0.5 ? -1 : 1);
  var travel = H + 80;
  p.style.left = startX + 'px';
  p.style.setProperty('--travel', travel + 'px');
  p.style.setProperty('--drift', drift + 'px');
  p.style.setProperty('--sc', sc.toFixed(2));
  p.style.opacity = (0.7 + Math.random() * 0.3).toFixed(2);
  p.style.animationDuration = dur.toFixed(2) + 's';
  p.style.animationDelay = (-(Math.random() * dur)).toFixed(2) + 's';
  inner.style.animationDuration = (1.6 + Math.random() * 1.8).toFixed(2) + 's';
  inner.style.animationDelay = (-(Math.random() * 2)).toFixed(2) + 's';
  inner.style.setProperty('--sc', sc.toFixed(2));
  stage.appendChild(p);
}
  },
  "hearts": function (stage) {
var W = stage.clientWidth, H = stage.clientHeight;
var N = 22;
var roses = ['#d98b96', '#e3a3ac', '#cf7f8b'];
for (var i = 0; i < N; i++){
  var el = document.createElement('div');
  el.className = 'heart';
  var size = 10 + Math.random() * 16;
  var dur = 7 + Math.random() * 6;
  var x = Math.random() * (W - size);
  var drift = (Math.random() - 0.5) * 70;
  var gold = (i % 6 === 2); // occasional gold heart
  var c1 = gold ? '#caa45a' : roses[i % roses.length];
  var c2 = gold ? '#e6cf94' : '#f3d6da';
  el.style.setProperty('--size', size + 'px');
  el.style.setProperty('--x', x + 'px');
  el.style.setProperty('--drift', drift + 'px');
  el.style.setProperty('--dur', dur + 's');
  el.style.setProperty('--travel', (H + 60) + 'px');
  el.style.setProperty('--c1', c1);
  el.style.setProperty('--c2', c2);
  el.style.setProperty('--peak', (0.6 + Math.random() * 0.35).toFixed(2));
  el.style.animationDelay = (-(Math.random() * dur)) + 's, ' + (-(Math.random() * dur)) + 's';
  stage.appendChild(el);
}
  },
  "confetti": function (stage) {
var W = stage.clientWidth, H = stage.clientHeight;
var N = 24;
for (var i = 0; i < N; i++){
  var el = document.createElement('div');
  var color = i % 5;
  el.className = 'cf cf-c' + color;

  var x = Math.random() * W;
  var dur = 2.6 + Math.random() * 2.4;        // a touch faster
  var scale = 0.7 + Math.random() * 0.7;
  var w = 6 + Math.random() * 4;
  var h = 11 + Math.random() * 6;

  var startY = -(20 + Math.random() * 60);
  var endY = H + 40;
  var drift = (Math.random() - 0.5) * (W * 0.35);
  var rz = (4 + Math.floor(Math.random() * 6)) * 360 * (Math.random() < 0.5 ? -1 : 1);
  var rx = (3 + Math.floor(Math.random() * 5)) * 360;

  el.style.left = x + 'px';
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.setProperty('--start', startY + 'px');
  el.style.setProperty('--end', endY + 'px');
  el.style.setProperty('--drift', drift + 'px');
  el.style.setProperty('--rz', rz + 'deg');
  el.style.setProperty('--rx', rx + 'deg');
  el.style.transform = 'scale(' + scale + ')';
  el.style.animationDuration = dur + 's';
  el.style.animationDelay = -(Math.random() * dur) + 's';

  stage.appendChild(el);
}
  },
  "lavender": function (stage) {
var W = stage.clientWidth, H = stage.clientHeight;
var travel = H + 80;
var pal = [['#dfd3ef','#b9a7d6','#cdbce6','#8f7fb0'],['#cdbce6','#8f7fb0','#dfd3ef','#6f5e95'],['#b9a7d6','#6f5e95','#dfd3ef','#8f7fb0']];
var n = 22;
for (var i = 0; i < n; i++){
  var bud = document.createElement('div');
  bud.className = 'bud';
  var scale = 0.55 + Math.random() * 0.85;
  var w = Math.round(16 * scale), h = Math.round(20 * scale);
  var x = Math.random() * (W - w);
  var dur = 9 + Math.random() * 8;
  var drift = (Math.random() * 70 - 35) + 'px';
  var p = pal[i % pal.length];
  bud.style.setProperty('--w', w + 'px');
  bud.style.setProperty('--h', h + 'px');
  bud.style.setProperty('--x', x + 'px');
  bud.style.setProperty('--dur', dur + 's');
  bud.style.setProperty('--drift', drift);
  bud.style.setProperty('--travel', travel + 'px');
  bud.style.setProperty('--r0', (Math.random() * 50 - 25) + 'deg');
  bud.style.setProperty('--r1', (Math.random() * 360 - 180 + (Math.random() < .5 ? 200 : -200)) + 'deg');
  bud.style.setProperty('--op', (0.7 + Math.random() * 0.3).toFixed(2));
  var fl = document.createElement('div');
  fl.className = 'floret';
  fl.style.setProperty('--c1', p[0]);
  fl.style.setProperty('--c2', p[1]);
  fl.style.setProperty('--c3', p[2]);
  fl.style.setProperty('--c4', p[3]);
  fl.style.setProperty('--amp', (1.5 + Math.random() * 2.5) + 'px');
  fl.style.setProperty('--sway', (2.2 + Math.random() * 2) + 's');
  var b = document.createElement('span'); b.className = 'b';
  var c = document.createElement('span'); c.className = 'c';
  fl.appendChild(b); fl.appendChild(c);
  var stem = document.createElement('span'); stem.className = 'stem';
  bud.appendChild(fl); bud.appendChild(stem);
  bud.style.animationDelay = (-Math.random() * dur) + 's';
  fl.style.animationDelay = (-Math.random() * 4) + 's';
  stage.appendChild(bud);
}
  },
  "bubbles": function (stage) {
var W = stage.clientWidth, H = stage.clientHeight;
var N = 22;
for (var i = 0; i < N; i++){
  var b = document.createElement('div');
  b.className = 'bub';
  var size = 14 + Math.random() * 36;
  var dur = 7 + Math.random() * 7;
  var wdur = 2.2 + Math.random() * 2.6;
  var x = Math.random() * (W - size);
  var drift = (Math.random() * 24 + 8) * (Math.random() < 0.5 ? -1 : 1);
  var op = 0.5 + Math.random() * 0.4;
  b.style.setProperty('--size', size + 'px');
  b.style.setProperty('--x', x + 'px');
  b.style.setProperty('--s', (0.85 + Math.random() * 0.3).toFixed(2));
  b.style.setProperty('--travel', (H + size + 40) + 'px');
  b.style.setProperty('--drift', drift + 'px');
  b.style.setProperty('--dur', dur.toFixed(2) + 's');
  b.style.setProperty('--wdur', wdur.toFixed(2) + 's');
  b.style.setProperty('--op', op.toFixed(2));
  b.style.bottom = (-size - 10) + 'px';
  b.style.animationDelay = (-(Math.random() * dur)).toFixed(2) + 's, ' + (-(Math.random() * wdur)).toFixed(2) + 's';
  stage.appendChild(b);
}
  },
  "bokeh": function (stage) {
var W = stage.clientWidth, H = stage.clientHeight;
var tints = [
  'radial-gradient(circle at 38% 35%, rgba(255,255,255,.95), rgba(255,233,200,.55) 45%, rgba(255,233,200,0) 72%)',
  'radial-gradient(circle at 40% 38%, rgba(255,250,245,.9), rgba(243,214,218,.5) 46%, rgba(243,214,218,0) 72%)',
  'radial-gradient(circle at 42% 36%, rgba(255,248,225,.85), rgba(232,209,138,.5) 46%, rgba(232,209,138,0) 73%)',
  'radial-gradient(circle at 36% 34%, rgba(255,255,255,.95), rgba(255,255,255,.4) 44%, rgba(255,255,255,0) 70%)'
];
var N = 24;
for (var i = 0; i < N; i++){
  var el = document.createElement('div');
  el.className = 'orb';

  // size: varied depth, large soft circles
  var size = 26 + Math.random() * 86;
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.background = tints[i % tints.length];

  // larger orbs sit fainter/further back
  var depth = size / 112;
  var op = (0.28 + Math.random() * 0.34) * (1 - depth * 0.4);
  el.style.setProperty('--op', op.toFixed(3));

  // blur scales a touch with size for depth (static, not animated)
  el.style.filter = 'blur(' + (5 + depth * 8).toFixed(1) + 'px)';

  // wander points kept within the stage area
  function pt(){
    var x = Math.random() * (W - size);
    var y = Math.random() * (H - size);
    return [x, y];
  }
  var p0 = pt(), p1 = pt(), p2 = pt();
  el.style.setProperty('--x0', p0[0].toFixed(1) + 'px');
  el.style.setProperty('--y0', p0[1].toFixed(1) + 'px');
  el.style.setProperty('--x1', p1[0].toFixed(1) + 'px');
  el.style.setProperty('--y1', p1[1].toFixed(1) + 'px');
  el.style.setProperty('--x2', p2[0].toFixed(1) + 'px');
  el.style.setProperty('--y2', p2[1].toFixed(1) + 'px');

  // gentle scale breathing
  el.style.setProperty('--s0', (0.85 + Math.random() * 0.25).toFixed(3));
  el.style.setProperty('--s1', (0.95 + Math.random() * 0.3).toFixed(3));
  el.style.setProperty('--s2', (0.9 + Math.random() * 0.3).toFixed(3));

  var dur = 16 + Math.random() * 14;
  el.style.animationDuration = dur.toFixed(2) + 's';
  el.style.animationDelay = (-(Math.random() * dur)).toFixed(2) + 's';

  stage.appendChild(el);
}
  },
  "feathers": function (stage) {
var H = stage.clientHeight, W = stage.clientWidth;
var N = 22;
for (var i = 0; i < N; i++){
  var dur = 8 + Math.random()*6;
  var feather = document.createElement('div');
  feather.className = 'feather';
  var sc = 0.6 + Math.random()*0.9;
  feather.style.width = (13*sc) + 'px';
  feather.style.height = (38*sc) + 'px';
  feather.style.left = (Math.random()*(W+20) - 10) + 'px';
  feather.style.setProperty('--travel', (H + 80) + 'px');
  feather.style.setProperty('--drift', (Math.random()*60 - 30) + 'px');
  feather.style.setProperty('--dur', dur + 's');
  feather.style.animationDelay = (-(Math.random()*dur)) + 's';
  feather.style.opacity = (0.7 + Math.random()*0.3).toFixed(2);

  var spin = document.createElement('div');
  spin.className = 'spin';
  spin.style.setProperty('--rot', (Math.random()*360) + 'deg');
  spin.style.setProperty('--rotEnd', (Math.random()*80 - 40) + 'deg');
  spin.style.setProperty('--spin', (6 + Math.random()*5) + 's');

  var sway = document.createElement('div');
  sway.className = 'sway';
  sway.style.setProperty('--swA', (10 + Math.random()*14) + 'deg');
  sway.style.setProperty('--sway', (3 + Math.random()*3).toFixed(2) + 's');
  sway.style.animationDelay = (-(Math.random()*4)) + 's';

  var vane = document.createElement('div');
  vane.className = 'vane';
  var quill = document.createElement('div');
  quill.className = 'quill';

  vane.appendChild(quill);
  sway.appendChild(vane);
  spin.appendChild(sway);
  feather.appendChild(spin);
  stage.appendChild(feather);
}
  },
  "lanterns": function (stage) {
var COUNT = 22;
var H = stage.clientHeight;
var W = stage.clientWidth;
var travel = H + 80;
for (var i = 0; i < COUNT; i++) {
  var lant = document.createElement('div');
  lant.className = 'lantern';
  var sway = document.createElement('span');
  sway.className = 'sway';
  var body = document.createElement('span');
  body.className = 'body';

  var scale = 0.55 + Math.random() * 0.75;
  var w = Math.round((16 + Math.random() * 8) * scale);
  var h = Math.round(w * (1.18 + Math.random() * 0.18));
  body.style.setProperty('--w', w + 'px');
  body.style.setProperty('--h', h + 'px');

  var dur = 10 + Math.random() * 8;
  var sdur = 2.4 + Math.random() * 2.2;
  var gdur = 1.6 + Math.random() * 1.8;
  var drift = (5 + Math.random() * 10) + 'px';

  lant.style.setProperty('--travel', travel + 'px');
  lant.style.setProperty('--dur', dur + 's');
  lant.style.animationDelay = -(Math.random() * dur) + 's';
  lant.style.left = Math.round(Math.random() * (W - w)) + 'px';

  sway.style.setProperty('--sdur', sdur + 's');
  sway.style.setProperty('--drift', drift);
  sway.style.animationDelay = -(Math.random() * sdur) + 's';

  body.style.setProperty('--gdur', gdur + 's');
  body.style.animationDelay = -(Math.random() * gdur) + 's';
  body.style.opacity = (0.78 + Math.random() * 0.22).toFixed(2);

  sway.appendChild(body);
  lant.appendChild(sway);
  stage.appendChild(lant);
}
  },
  "ribbons": function (stage) {
var W = stage.clientWidth, H = stage.clientHeight;
var travel = H + 140;
var palette = [
  ['#caa45a','#a8863f'],
  ['#d98b96','#bf6d79'],
  ['#6f7444','#565a32'],
  ['#8fb0c9','#6f93af']
];
var N = 22;
for (var i = 0; i < N; i++){
  var ribbon = document.createElement('div');
  ribbon.className = 'ribbon';
  var strip = document.createElement('div');
  strip.className = 'strip';
  ribbon.appendChild(strip);

  var pair = palette[i % palette.length];
  var w = 5 + Math.random() * 6;            // thin strips 5-11px
  var h = 46 + Math.random() * 70;           // varied lengths 46-116px
  var x = Math.random() * (W - w);
  var dur = 6.5 + Math.random() * 5.5;       // fall duration
  var twist = 2.2 + Math.random() * 2.6;     // 3D twist period
  var drift = (Math.random() * 60 - 30);     // horizontal sway px
  var r0 = (Math.random() * 30 - 15);        // base tilt
  var r1 = r0 + (Math.random() * 40 - 20);   // mid tilt

  ribbon.style.setProperty('--w', w + 'px');
  ribbon.style.setProperty('--h', h + 'px');
  ribbon.style.setProperty('--x', x + 'px');
  ribbon.style.setProperty('--travel', travel + 'px');
  ribbon.style.setProperty('--drift', drift + 'px');
  ribbon.style.setProperty('--dur', dur + 's');
  ribbon.style.setProperty('--twist', twist + 's');
  ribbon.style.setProperty('--r0', r0 + 'deg');
  ribbon.style.setProperty('--r1', r1 + 'deg');
  strip.style.setProperty('--c', pair[0]);
  strip.style.setProperty('--c2', pair[1]);
  strip.style.setProperty('--dur', dur + 's');
  strip.style.setProperty('--twist', twist + 's');

  var delay = -(Math.random() * dur);
  ribbon.style.animationDelay = delay + 's';
  strip.style.animationDelay = delay + 's';

  stage.appendChild(ribbon);
}
  },
  "autumn": function (stage) {
var palettes = [
  ['#d99a3c','#c0622d','#a83b2a'],
  ['#c0622d','#a83b2a','#8a5a1e'],
  ['#d99a3c','#c0622d','#8a5a1e'],
  ['#a83b2a','#8a5a1e','#5e3414'],
  ['#e0a84a','#d99a3c','#c0622d']
];
var W = stage.clientWidth, H = stage.clientHeight;
var count = 24;
for (var i = 0; i < count; i++){
  var leaf = document.createElement('div');
  leaf.className = 'leaf';
  var blade = document.createElement('div');
  blade.className = 'blade';
  var vein = document.createElement('div');
  vein.className = 'vein';
  blade.appendChild(vein);
  leaf.appendChild(blade);

  var sz = 12 + Math.random() * 18;
  var x = Math.random() * (W - sz);
  var drift = (Math.random() * 70 - 35);
  var dur = 7 + Math.random() * 6;
  var tdur = 2.5 + Math.random() * 2.5;
  var travel = H + 80;
  var pal = palettes[(Math.random() * palettes.length) | 0];

  leaf.style.setProperty('--sz', sz + 'px');
  leaf.style.setProperty('--x', x + 'px');
  leaf.style.setProperty('--drift', drift + 'px');
  leaf.style.setProperty('--travel', travel + 'px');
  leaf.style.setProperty('--dur', dur + 's');
  leaf.style.setProperty('--tdur', tdur + 's');
  leaf.style.setProperty('--c1', pal[0]);
  leaf.style.setProperty('--c2', pal[1]);
  leaf.style.setProperty('--c3', pal[2]);
  leaf.style.opacity = (0.78 + Math.random() * 0.22).toFixed(2);
  leaf.style.animationDelay = (-(Math.random() * dur)).toFixed(2) + 's';
  blade.style.animationDelay = (-(Math.random() * tdur)).toFixed(2) + 's';

  stage.appendChild(leaf);
}
  },
  "dandelion": function (stage) {
var W = stage.clientWidth, H = stage.clientHeight;
var N = 30;
for (var i = 0; i < N; i++){
  var seed = document.createElement('div');
  seed.className = 'seed';
  var sz = 18 + Math.random() * 16;          // 18-34px tufts
  var x = Math.random() * (W - sz);
  var drift = (Math.random() * 70 + 30) * (Math.random() < .5 ? -1 : 1);
  var dur = 9 + Math.random() * 8;            // 9-17s slow float
  var delay = -Math.random() * dur;           // desync
  var spin = 7 + Math.random() * 9;           // slow tuft rotation
  seed.style.setProperty('--sz', sz + 'px');
  seed.style.setProperty('--x', x + 'px');
  seed.style.setProperty('--drift', drift + 'px');
  seed.style.setProperty('--travel', (H + 90) + 'px');
  seed.style.setProperty('--dur', dur + 's');
  seed.style.setProperty('--delay', delay + 's');
  seed.style.setProperty('--spin', spin + 's');
  seed.style.opacity = (0.7 + Math.random() * 0.3).toFixed(2);

  var tuft = document.createElement('div'); tuft.className = 'tuft';
  var hub = document.createElement('div');  hub.className  = 'hub';
  var stem = document.createElement('div'); stem.className = 'stem';
  var body = document.createElement('div'); body.className = 'body';
  tuft.appendChild(hub);
  seed.appendChild(tuft);
  seed.appendChild(stem);
  seed.appendChild(body);
  stage.appendChild(seed);
}
  },
  "musicnotes": function (stage) {
var W=stage.clientWidth,H=stage.clientHeight;
var colors=['#6f7444','#caa45a','#43412f','#8a9a5b'];
var N=24;
for(var i=0;i<N;i++){
  var beamed=Math.random()<0.38;
  var el=document.createElement('div');
  el.className='note'+(beamed?' beamed':'');
  var c=colors[(Math.random()*colors.length)|0];
  var scale=0.62+Math.random()*0.7;
  var dur=7+Math.random()*6;
  var travel=H+80;
  var startX=Math.random()*(W-30);
  var sway=(8+Math.random()*22)*(Math.random()<0.5?-1:1);
  var peak=0.55+Math.random()*0.4;
  var head=document.createElement('div');head.className='head';head.style.background=c;
  var stem=document.createElement('div');stem.className='stem';stem.style.background=c;
  el.appendChild(head);el.appendChild(stem);
  if(beamed){
    var head2=document.createElement('div');head2.className='head2';head2.style.background=c;
    var stem2=document.createElement('div');stem2.className='stem2';stem2.style.background=c;
    var beam=document.createElement('div');beam.className='beam';beam.style.background=c;
    el.appendChild(head2);el.appendChild(stem2);el.appendChild(beam);
  }else{
    var flag=document.createElement('div');flag.className='flag';flag.style.background=c;
    el.appendChild(flag);
  }
  el.style.left=startX+'px';
  el.style.bottom='-20px';
  el.style.transform='scale('+scale+')';
  el.style.setProperty('--travel',travel+'px');
  el.style.setProperty('--sway',sway+'px');
  el.style.setProperty('--peak',peak.toFixed(2));
  el.style.setProperty('--rot0',(Math.random()*20-10)+'deg');
  el.style.setProperty('--rot1',(Math.random()*30-15)+'deg');
  el.style.setProperty('--rot2',(Math.random()*40-20)+'deg');
  el.style.animationDuration=dur+'s';
  el.style.animationDelay=(-Math.random()*dur)+'s';
  stage.appendChild(el);
}
  },
};
