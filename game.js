/* APEX HORIZON — phone circuit racer. Three r160 global. */
(function () {
  const $ = (id) => document.getElementById(id);
  const CARS = [
    { id: "gt", name: "Horizon GT", cls: "S1", pi: 742, color: 0x1c6dff, accent: 0xf0b429, accel: 26, top: 74, grip: 0.84, turn: 1.65, brake: 40, drive: "RWD", price: 0 },
    { id: "ev", name: "Pulse EV", cls: "S1", pi: 768, color: 0xe8eef6, accent: 0x3ee0ff, accel: 32, top: 70, grip: 0.92, turn: 1.55, brake: 44, drive: "AWD", price: 0 },
    { id: "mu", name: "Vesper Muscle", cls: "A", pi: 701, color: 0xc43b2c, accent: 0x111111, accel: 24, top: 78, grip: 0.7, turn: 1.45, brake: 36, drive: "RWD", price: 0 },
    { id: "ra", name: "Ridge Rally", cls: "A", pi: 664, color: 0xf2a23a, accent: 0x1b1b1b, accel: 22, top: 66, grip: 0.8, turn: 1.7, brake: 38, drive: "AWD", price: 0 }
  ];
  const TRACKS = [
    {
      id: "ring", name: "Festival Ring", laps: 3, len: "2.1 km",
      pts: [[0, 0, 0], [50, 0.4, 30], [95, 1.2, 80], [110, 3.5, 140], [70, 6, 190], [10, 5, 210], [-50, 2.5, 185], [-95, 1, 130], [-110, 0.4, 70], [-70, 0, 20]]
    },
    {
      id: "canyon", name: "Red Canyon", laps: 3, len: "2.6 km",
      pts: [[0, 1, 0], [70, 2, 10], [140, 6, 50], [180, 12, 120], [150, 16, 190], [70, 14, 230], [-10, 8, 210], [-80, 4, 160], [-130, 2, 90], [-90, 1, 20]]
    }
  ];
  const RIVALS = ["M. Okada", "L. Voss", "S. Rahman", "A. Petrova", "J. Hale", "C. Nunez", "R. Idris"];

  const save = JSON.parse(localStorage.getItem("apex-horizon") || "{}");
  save.cr = save.cr || 2400;
  save.up = save.up || {};
  save.best = save.best || {};
  const persist = () => localStorage.setItem("apex-horizon", JSON.stringify(save));

  let carId = "gt", trackId = "ring";
  let renderer, scene, camera, world, clock;
  let player, racers = [], raceOn = false, finished = false;
  let countdown = 0, msg = "", msgT = 0, raceTime = 0;
  let input = { steer: 0, throttle: 0, brake: 0, hb: 0, auto: false };
  let tiltOn = false, tiltSteer = 0;
  let keys = {};

  function upgrades(id) {
    return save.up[id] || { eng: 0, tire: 0, aero: 0 };
  }
  function spec(base) {
    const u = upgrades(base.id);
    return {
      ...base,
      accel: base.accel * (1 + u.eng * 0.08),
      top: base.top * (1 + u.eng * 0.04 - u.aero * 0.015),
      grip: Math.min(0.97, base.grip + u.tire * 0.04 + u.aero * 0.02),
      turn: base.turn * (1 + u.tire * 0.03),
      pi: base.pi + u.eng * 12 + u.tire * 10 + u.aero * 8
    };
  }

  function buildTrack(def) {
    const curve = new THREE.CatmullRomCurve3(def.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), true, "catmullrom", 0.15);
    const N = 280;
    const frames = [];
    let length = 0;
    let prev = curve.getPointAt(0);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const pos = curve.getPointAt(t);
      const tan = curve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0));
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      length += pos.distanceTo(prev);
      prev = pos;
      const ahead = curve.getTangentAt((t + 0.02) % 1);
      const curveAmt = 1 - tan.dot(ahead);
      frames.push({ t, pos: pos.clone(), tan, right, curve: curveAmt, dist: length });
    }
    const width = 14;
    const geo = new THREE.BufferGeometry();
    const posA = [], uv = [], idx = [];
    frames.forEach((f, i) => {
      const l = f.pos.clone().addScaledVector(f.right, -width);
      const r = f.pos.clone().addScaledVector(f.right, width);
      posA.push(l.x, l.y + 0.05, l.z, r.x, r.y + 0.05, r.z);
      uv.push(0, i / 6, 1, i / 6);
      if (i < frames.length - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    geo.setAttribute("position", new THREE.Float32BufferAttribute(posA, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.86, metalness: 0.05 }));
    road.receiveShadow = true;

    const edge = new THREE.BufferGeometry();
    const epos = [];
    frames.forEach((f) => {
      [-1, 1].forEach((s) => {
        const p = f.pos.clone().addScaledVector(f.right, s * (width + 0.3));
        epos.push(p.x, p.y + 0.2, p.z);
      });
    });
    edge.setAttribute("position", new THREE.Float32BufferAttribute(epos, 3));
    const lines = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: 0xf0b429 }));

    const group = new THREE.Group();
    group.add(road, lines);
    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(420, 40),
      new THREE.MeshStandardMaterial({ color: 0x1d3a28, roughness: 1 })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.4;
    group.add(grass);

    for (let i = 0; i < frames.length; i += 7) {
      const f = frames[i];
      [-1, 1].forEach((s) => {
        const tree = new THREE.Mesh(
          new THREE.ConeGeometry(1.6, 7, 6),
          new THREE.MeshStandardMaterial({ color: s < 0 ? 0x1e5a34 : 0x246b3c })
        );
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.4, 5), new THREE.MeshStandardMaterial({ color: 0x5a3b24 }));
        const p = f.pos.clone().addScaledVector(f.right, s * (22 + (i % 5)));
        tree.position.copy(p);
        tree.position.y += 3.2;
        trunk.position.copy(p);
        trunk.position.y += 0.6;
        group.add(tree, trunk);
      });
    }
    // grandstand near start
    const stand = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 6), new THREE.MeshStandardMaterial({ color: 0x243044 }));
    const f0 = frames[4];
    stand.position.copy(f0.pos).addScaledVector(f0.right, 20);
    stand.position.y += 2.4;
    group.add(stand);

    const banner = new THREE.Mesh(new THREE.BoxGeometry(width * 1.4, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0xf0b429, emissive: 0x5a3e00 }));
    banner.position.copy(frames[0].pos);
    banner.position.y += 6;
    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    const postR = postL.clone();
    postL.position.copy(frames[0].pos).addScaledVector(frames[0].right, -width * 0.7);
    postR.position.copy(frames[0].pos).addScaledVector(frames[0].right, width * 0.7);
    postL.position.y += 3;
    postR.position.y += 3;
    group.add(banner, postL, postR);

    return { curve, frames, width, group, laps: def.laps, name: def.name, id: def.id };
  }

  function makeCar(color, accent) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 4.1), new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.35 }));
    body.position.y = 0.55;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 1.6), new THREE.MeshStandardMaterial({ color: 0x111820, metalness: 0.2, roughness: 0.15 }));
    cab.position.set(0, 0.95, -0.2);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.35 }));
    nose.position.set(0, 0.5, 2.05);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.35), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    wing.position.set(0, 1.05, -1.9);
    g.add(body, cab, nose, wing);
    const wheels = [];
    [[-0.85, 1.25], [0.85, 1.25], [-0.85, -1.3], [0.85, -1.3]].forEach(([x, z], i) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.28, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.34, z);
      w.userData.steer = i < 2;
      g.add(w);
      wheels.push(w);
    });
    g.userData.wheels = wheels;
    return g;
  }

  function spawnRacer(base, isPlayer, index) {
    const s = isPlayer ? spec(base) : base;
    const mesh = makeCar(s.color, s.accent);
    scene.add(mesh);
    return {
      spec: s, mesh, isPlayer, name: isPlayer ? "You" : RIVALS[index % RIVALS.length],
      progress: 0, lap: 0, lapsDone: 0, speed: 0, yaw: 0, steer: 0,
      finished: false, finishTime: 0, lapStart: 0, best: Infinity, lastLap: 0,
      checkpoints: 0, offset: (index - 3) * 2.2
    };
  }

  function frameAt(track, t) {
    const f = track.frames;
    const x = ((t % 1) + 1) % 1;
    const i = Math.min(f.length - 2, Math.floor(x * (f.length - 1)));
    const a = f[i], b = f[i + 1];
    const k = (x - a.t) / Math.max(1e-6, b.t - a.t);
    return {
      pos: a.pos.clone().lerp(b.pos, k),
      tan: a.tan.clone().lerp(b.tan, k).normalize(),
      right: a.right.clone().lerp(b.right, k).normalize(),
      curve: a.curve
    };
  }

  function placeOnGrid() {
    racers.forEach((r) => {
      const slot = r.isPlayer ? 0 : racers.filter((x) => !x.isPlayer).indexOf(r) + 1;
      const t = 0.985 - slot * 0.012;
      const f = frameAt(world, t);
      const side = (slot % 2 === 0 ? -1 : 1) * 2.4;
      r.mesh.position.copy(f.pos).addScaledVector(f.right, side);
      r.mesh.position.y += 0.1;
      r.yaw = Math.atan2(f.tan.x, f.tan.z);
      r.mesh.rotation.y = r.yaw;
      r.progress = t;
      r.lap = 0;
      r.lapsDone = 0;
      r.speed = 0;
      r.finished = false;
      r.finishTime = 0;
      r.checkpoints = 0;
      r.lapStart = 0;
      r.best = save.best[world.id] || Infinity;
    });
  }

  function updateRacer(r, dt, allow) {
    if (r.finished) return;
    let throttle = 0, brake = 0, steer = 0, hb = 0;
    if (r.isPlayer) {
      steer = input.steer;
      throttle = input.auto ? 1 : input.throttle;
      brake = input.brake;
      hb = input.hb;
      if (!allow) { throttle = 0; brake = 1; }
    } else {
      const look = frameAt(world, r.progress + 0.02);
      const ahead = frameAt(world, r.progress + 0.008);
      const desired = look.pos.clone().addScaledVector(look.right, r.offset * 0.3);
      const to = desired.clone().sub(r.mesh.position);
      to.y = 0;
      const targetYaw = Math.atan2(to.x, to.z);
      let diff = targetYaw - r.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      steer = THREE.MathUtils.clamp(diff * 2.4, -1, 1);
      const caution = ahead.curve * 18 + Math.abs(steer) * 0.25;
      const want = r.spec.top * (0.72 - caution);
      throttle = r.speed < want ? 1 : 0.35;
      brake = r.speed > want + 6 ? 1 : 0;
    }

    const s = r.spec;
    const grip = s.grip * (hb ? 0.45 : 1);
    r.speed += throttle * s.accel * dt;
    r.speed -= brake * s.brake * dt;
    r.speed -= r.speed * r.speed * 0.0032 * dt;
    r.speed = THREE.MathUtils.clamp(r.speed, -10, s.top);
    const turn = steer * s.turn * (0.35 + Math.min(r.speed, 36) / 36);
    r.yaw += turn * dt * (hb ? 1.7 : 1);
    if (Math.abs(steer) > 0.4 && r.speed > 22) r.speed -= (1 - grip) * 10 * dt;

    const fwd = new THREE.Vector3(Math.sin(r.yaw), 0, Math.cos(r.yaw));
    r.mesh.position.addScaledVector(fwd, r.speed * dt);

    // snap height / lateral to road
    let best = 0, bestD = 1e9;
    const step = 4;
    for (let i = 0; i < world.frames.length; i += step) {
      const d = world.frames[i].pos.distanceToSquared(r.mesh.position);
      if (d < bestD) { bestD = d; best = i; }
    }
    const f = world.frames[best];
    const rel = r.mesh.position.clone().sub(f.pos);
    let lat = rel.dot(f.right);
    const half = world.width - 1.2;
    if (Math.abs(lat) > half) {
      r.speed *= 1 - dt * 1.6;
      lat = THREE.MathUtils.clamp(lat, -half - 1.5, half + 1.5);
    }
    const along = rel.dot(f.tan);
    r.mesh.position.copy(f.pos).addScaledVector(f.right, lat).addScaledVector(f.tan, along);
    r.mesh.position.y = f.pos.y + 0.05;
    r.mesh.rotation.y = r.yaw;
    r.mesh.rotation.z = -steer * 0.06;
    r.mesh.userData.wheels.forEach((w) => {
      w.rotation.x += r.speed * dt * 0.4;
      if (w.userData.steer) w.rotation.y = steer * 0.35;
    });

    const prev = r.progress;
    r.progress = f.t;
    if (allow && prev > 0.85 && r.progress < 0.15) {
      r.lapsDone += 1;
      const now = raceTime;
      if (r.lapStart) {
        r.lastLap = now - r.lapStart;
        if (r.isPlayer && r.lastLap < r.best) {
          r.best = r.lastLap;
          save.best[world.id] = r.best;
          persist();
        }
      }
      r.lapStart = now;
      if (r.lapsDone >= world.laps) {
        r.finished = true;
        r.finishTime = now;
      }
    }
  }

  function fmt(t) {
    if (!isFinite(t) || t <= 0) return "--";
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ":" + s.toFixed(2).padStart(5, "0");
  }

  function standings() {
    return racers.slice().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return (b.lapsDone + b.progress) - (a.lapsDone + a.progress);
    });
  }

  function drawMap() {
    const c = $("minimap");
    const g = c.getContext("2d");
    g.clearRect(0, 0, 140, 140);
    const pts = world.frames.filter((_, i) => i % 3 === 0).map((f) => f.pos);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    pts.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
    const sx = (x) => 12 + (x - minX) / (maxX - minX) * 116;
    const sy = (z) => 12 + (z - minZ) / (maxZ - minZ) * 116;
    g.strokeStyle = "#f0b429";
    g.lineWidth = 3;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(sx(p.x), sy(p.z)) : g.moveTo(sx(p.x), sy(p.z))));
    g.closePath();
    g.stroke();
    racers.forEach((r) => {
      g.fillStyle = r.isPlayer ? "#ffffff" : "#7fd0ff";
      g.beginPath();
      g.arc(sx(r.mesh.position.x), sy(r.mesh.position.z), r.isPlayer ? 4 : 2.5, 0, 7);
      g.fill();
    });
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(0.033, clock.getDelta());
    if (raceOn) {
      raceTime += dt;
      if (countdown > 0) {
        countdown -= dt;
        const n = Math.ceil(countdown);
        msg = n > 0 ? String(n) : "GO";
        if (countdown <= 0) msgT = 0.8;
      } else if (msgT > 0) {
        msgT -= dt;
        if (msgT <= 0) msg = "";
      }
      const allow = countdown <= 0;
      readInput();
      racers.forEach((r) => updateRacer(r, dt, allow));
      const order = standings();
      const me = order.indexOf(player) + 1;
      $("pos").innerHTML = me + "<small>/" + order.length + "</small>";
      const kmh = Math.abs(player.speed) * 3.6;
      $("speed").innerHTML = Math.round(kmh) + "<small> KM/H</small>";
      const gear = player.speed < 2 ? "N" : Math.min(6, 1 + Math.floor(player.speed / (player.spec.top / 6)));
      $("gear").textContent = gear;
      $("rpm").firstChild.style.width = Math.min(100, (player.speed / player.spec.top) * 100) + "%";
      const lapT = player.lapStart ? raceTime - player.lapStart : raceTime;
      $("lap").innerHTML = "<b>" + fmt(lapT || 0) + "</b><div>LAP " + Math.min(world.laps, player.lapsDone + 1) + "/" + world.laps + " · BEST " + fmt(player.best) + "</div>";
      $("msg").textContent = msg;
      drawMap();

      const back = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
      const camT = player.mesh.position.clone().addScaledVector(back, -8).add(new THREE.Vector3(0, 3.1, 0));
      camera.position.lerp(camT, 1 - Math.pow(0.0008, dt));
      camera.lookAt(player.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(back, 6));
      camera.fov = 62 + Math.min(16, player.speed * 0.18);
      camera.updateProjectionMatrix();

      if (!finished && player.finished) {
        finished = true;
        raceOn = false;
        endRace();
      }
    }
    renderer.render(scene, camera);
  }

  function endRace() {
    const order = standings();
    const place = order.indexOf(player) + 1;
    const payout = [1800, 1200, 800, 500, 350, 250, 180, 120][place - 1] || 100;
    save.cr += payout;
    persist();
    $("placeLine").textContent = "P" + place;
    $("board").innerHTML = "<table>" + order.map((r, i) =>
      "<tr class='" + (r.isPlayer ? "me" : "") + "'><td>P" + (i + 1) + "</td><td>" + r.name + "</td><td>" + (r.finished ? fmt(r.finishTime) : "DNF") + "</td></tr>"
    ).join("") + "</table><p class='sub'>+" + payout + " CR</p>";
    $("hud").classList.add("hidden");
    $("results").classList.remove("hidden");
  }

  function readInput() {
    let steer = tiltOn ? tiltSteer : 0;
    if (keys["ArrowLeft"] || keys["a"]) steer -= 1;
    if (keys["ArrowRight"] || keys["d"]) steer += 1;
    if (touchSteer !== null) steer = touchSteer;
    input.steer = THREE.MathUtils.clamp(steer, -1, 1);
    input.throttle = (keys["ArrowUp"] || keys["w"] || gasDown) ? 1 : 0;
    input.brake = (keys["ArrowDown"] || keys["s"] || brakeDown) ? 1 : 0;
    input.hb = (keys[" "] || hbDown) ? 1 : 0;
  }

  let touchSteer = null, gasDown = false, brakeDown = false, hbDown = false;

  function boot3d() {
    const canvas = $("view");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x8aa4c2, 40, 260);
    scene.background = new THREE.Color(0x87a8c9);
    camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 6, -12);
    clock = new THREE.Clock();
    scene.add(new THREE.HemisphereLight(0xfff1d6, 0x1c3a28, 0.85));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.35);
    sun.position.set(40, 60, 20);
    scene.add(sun);
    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
    loop();
  }

  function startRace() {
    if (world) scene.remove(world.group);
    racers.forEach((r) => scene.remove(r.mesh));
    const def = TRACKS.find((t) => t.id === trackId);
    world = buildTrack(def);
    scene.add(world.group);
    const base = CARS.find((c) => c.id === carId);
    player = spawnRacer(base, true, 0);
    racers = [player];
    for (let i = 0; i < 7; i++) racers.push(spawnRacer(CARS[i % CARS.length], false, i));
    placeOnGrid();
    finished = false;
    raceOn = true;
    countdown = 3.2;
    raceTime = 0;
    msg = "3";
    $("garage").classList.add("hidden");
    $("results").classList.add("hidden");
    $("hud").classList.remove("hidden");
  }

  function paintGarage() {
    $("credits").textContent = "CR " + save.cr;
    $("carList").innerHTML = CARS.map((c) => {
      const s = spec(c);
      return "<button class='car" + (c.id === carId ? " on" : "") + "' data-car='" + c.id + "'><span class='pi'>" + s.pi + "</span><b>" + c.name + "</b><small>" + c.cls + " · " + c.drive + "</small></button>";
    }).join("");
    $("carList").querySelectorAll("button").forEach((b) => b.onclick = () => { carId = b.dataset.car; paintGarage(); });
    const c = CARS.find((x) => x.id === carId);
    const s = spec(c);
    $("carName").textContent = c.name;
    $("carMeta").textContent = c.cls + "  ·  PI " + s.pi + "  ·  " + c.drive;
    const bars = [["Speed", s.top / 80], ["Accel", s.accel / 36], ["Grip", s.grip], ["Turn", s.turn / 2]];
    $("stats").innerHTML = bars.map(([n, v]) => "<div>" + n + "</div><div class='stat'><i style='width:" + Math.round(v * 100) + "%'></i></div>").join("");
    const u = upgrades(c.id);
    const cost = (k) => 400 + u[k] * 350;
    $("upgrades").innerHTML = [["eng", "Engine"], ["tire", "Tires"], ["aero", "Aero"]].map(([k, n]) =>
      "<div class='up'><span>" + n + " +" + u[k] + "</span><button class='btn' data-up='" + k + "'" + (u[k] >= 3 ? " disabled" : "") + ">" + (u[k] >= 3 ? "MAX" : cost(k) + " CR") + "</button></div>"
    ).join("");
    $("upgrades").querySelectorAll("button").forEach((b) => b.onclick = () => {
      const k = b.dataset.up;
      const price = cost(k);
      if (u[k] >= 3 || save.cr < price) return;
      save.cr -= price;
      u[k] += 1;
      save.up[c.id] = u;
      persist();
      paintGarage();
    });
    $("trackList").innerHTML = TRACKS.map((t) =>
      "<button data-track='" + t.id + "' class='" + (t.id === trackId ? "on" : "") + "'><b>" + t.name + "</b><div>" + t.len + " · " + t.laps + " laps</div></button>"
    ).join("");
    $("trackList").querySelectorAll("button").forEach((b) => b.onclick = () => { trackId = b.dataset.track; paintGarage(); });
  }

  function bind() {
    $("goGarage").onclick = () => { $("boot").classList.add("hidden"); $("garage").classList.remove("hidden"); paintGarage(); };
    $("raceBtn").onclick = startRace;
    $("again").onclick = startRace;
    $("toGarage").onclick = () => { $("results").classList.add("hidden"); $("garage").classList.remove("hidden"); paintGarage(); };
    $("pause").onclick = () => { raceOn = false; $("hud").classList.add("hidden"); $("garage").classList.remove("hidden"); paintGarage(); };
    $("auto").onclick = () => { input.auto = !input.auto; $("auto").style.borderColor = input.auto ? "#f0b429" : ""; };
    $("tilt").onclick = async () => {
      if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
        try { await DeviceOrientationEvent.requestPermission(); } catch (e) {}
      }
      tiltOn = !tiltOn;
      $("tilt").style.borderColor = tiltOn ? "#f0b429" : "";
    };
    window.addEventListener("deviceorientation", (e) => {
      const g = e.gamma || 0;
      tiltSteer = THREE.MathUtils.clamp(g / 28, -1, 1);
    });
    const zone = $("steerZone");
    zone.addEventListener("pointerdown", (e) => { zone.setPointerCapture(e.pointerId); touchSteer = ((e.clientX / zone.clientWidth) - 0.5) * 2; });
    zone.addEventListener("pointermove", (e) => { if (touchSteer !== null) touchSteer = ((e.clientX / zone.clientWidth) - 0.5) * 2; });
    const up = () => { touchSteer = null; };
    zone.addEventListener("pointerup", up);
    zone.addEventListener("pointercancel", up);
    const hold = (el, set) => {
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); set(true); });
      el.addEventListener("pointerup", () => set(false));
      el.addEventListener("pointerleave", () => set(false));
      el.addEventListener("pointercancel", () => set(false));
    };
    hold($("pedal"), (v) => gasDown = v);
    hold($("brake"), (v) => brakeDown = v);
    hold($("hb"), (v) => hbDown = v);
    window.addEventListener("keydown", (e) => { keys[e.key] = true; });
    window.addEventListener("keyup", (e) => { keys[e.key] = false; });
  }

  bind();
  boot3d();
})();
