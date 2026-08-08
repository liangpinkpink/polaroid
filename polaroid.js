(() => {
  const photos = Array.isArray(window.WEDDING_PHOTOS) ? window.WEDDING_PHOTOS : [];
  const camera = document.querySelector('#camera');
  const scene = document.querySelector('.scene');
  const options = document.querySelector('#cameraOptions');
  const cameraImage = document.querySelector('#cameraImage');
  const sheet = document.querySelector('#developing');
  const chute = document.querySelector('#paperChute');
  const image = document.querySelector('#currentPhoto');
  const ok = document.querySelector('#okButton');
  const pile = document.querySelector('#photoPile');
  const flash = document.querySelector('#flashScreen');
  const backgroundToggle = document.querySelector('#backgroundToggle');
  const backgroundPanel = document.querySelector('#backgroundPanel');
  const backgroundColor = document.querySelector('#backgroundColor');
  const backgroundImage = document.querySelector('#backgroundImage');
  const backgroundReset = document.querySelector('#backgroundReset');
  const CARD_W = 226;
  const CARD_H = 300;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const random = (min, max) => min + Math.random() * (max - min);
  const sign = () => (Math.random() < .5 ? -1 : 1);
  const smoothstep = t => t * t * (3 - 2 * t);
  const mix = (a, b, t) => a + (b - a) * t;
  const naturalTilt = () => {
    const magnitude = Math.random() < .22 ? random(20, 30) : random(6, 19);
    return sign() * magnitude;
  };
  let current = null;
  let printListener = null;
  let shotToken = 0;
  let activeBackgroundUrl = '';
  let photoDeck = [];
  let printFinished = false;
  let developFinished = false;
  const photoCache = new Map();

  const backgroundStorage = {
    color: 'polaroid-background-color',
    image: 'polaroid-background-image'
  };

  function setBackgroundColor(color, persist = true) {
    document.documentElement.style.setProperty('--custom-bg-color', color);
    scene.style.backgroundColor = color;
    if (persist) localStorage.setItem(backgroundStorage.color, color);
  }

  function setBackgroundImage(dataUrl, persist = true) {
    scene.style.backgroundImage = `url("${dataUrl}")`;
    if (persist) {
      try {
        localStorage.setItem(backgroundStorage.image, dataUrl);
      } catch {
        // Large images still work for the current session.
      }
    }
  }

  function restoreBackgroundPreference() {
    const savedColor = localStorage.getItem(backgroundStorage.color);
    const savedImage = localStorage.getItem(backgroundStorage.image);
    if (savedColor) {
      backgroundColor.value = savedColor;
      setBackgroundColor(savedColor, false);
    }
    if (savedImage) setBackgroundImage(savedImage, false);
  }

  function clearCustomBackground() {
    if (activeBackgroundUrl) URL.revokeObjectURL(activeBackgroundUrl);
    activeBackgroundUrl = '';
    document.documentElement.style.removeProperty('--custom-bg-color');
    document.documentElement.style.removeProperty('--custom-bg-image');
    scene.style.removeProperty('background-color');
    scene.style.removeProperty('background-image');
    localStorage.removeItem(backgroundStorage.color);
    localStorage.removeItem(backgroundStorage.image);
    backgroundColor.value = '#f7f4ec';
    backgroundImage.value = '';
  }

  backgroundToggle?.addEventListener('click', () => {
    const opening = backgroundPanel.hidden;
    backgroundPanel.hidden = !opening;
    backgroundToggle.setAttribute('aria-expanded', String(opening));
  });

  backgroundColor?.addEventListener('input', event => {
    setBackgroundColor(event.target.value);
  });

  backgroundImage?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (activeBackgroundUrl) URL.revokeObjectURL(activeBackgroundUrl);
    activeBackgroundUrl = URL.createObjectURL(file);
    scene.style.backgroundImage = `url("${activeBackgroundUrl}")`;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        setBackgroundImage(reader.result);
        URL.revokeObjectURL(activeBackgroundUrl);
        activeBackgroundUrl = '';
      }
    });
    reader.readAsDataURL(file);
  });

  backgroundReset?.addEventListener('click', clearCustomBackground);

  restoreBackgroundPreference();

  class PhotoPile {
    constructor(element) {
      this.element = element;
      this.photos = [];
      this.motions = new Map();
      this.nextId = 1;
      this.nextZ = 10;
      this.frame = 0;
      this.previousTime = 0;
      this.tick = this.tick.bind(this);
    }

    bounds() {
      return {
        width: this.element.clientWidth,
        height: Math.max(this.element.clientHeight, innerHeight * .48, CARD_H + 80)
      };
    }

    limits() {
      const bounds = this.bounds();
      return {
        minX: -(bounds.width - CARD_W) / 2 + 72,
        maxX: (bounds.width - CARD_W) / 2 - 72,
        minY: -Math.max(0, innerHeight * .72),
        maxY: bounds.height - CARD_H - 52
      };
    }

    overlap(a, b) {
      const width = Math.max(0, Math.min(a.x + CARD_W / 2, b.x + CARD_W / 2) -
        Math.max(a.x - CARD_W / 2, b.x - CARD_W / 2));
      const height = Math.max(0, Math.min(a.y + CARD_H, b.y + CARD_H) - Math.max(a.y, b.y));
      return width * height / (CARD_W * CARD_H);
    }

    variedTilt() {
      if (!this.photos.length) return naturalTilt();
      const recent = this.photos.slice(-6);
      let best = naturalTilt();
      let bestDifference = -1;
      for (let index = 0; index < 10; index += 1) {
        const candidate = naturalTilt();
        const difference = Math.min(...recent.map(photo => Math.abs(candidate - photo.rotation)));
        if (difference > bestDifference) {
          best = candidate;
          bestDifference = difference;
        }
      }
      return best;
    }

    landingSpot(preferredX = 0) {
      const count = this.photos.length;
      const bounds = this.bounds();
      const limits = this.limits();
      const perLayer = Math.max(3, Math.floor(bounds.width / (CARD_W * .68)));
      const layer = Math.floor(count / perLayer);
      const baseY = clamp(limits.maxY - layer * CARD_H * .24, limits.minY, limits.maxY);
      const fill = clamp(.38 + count / Math.max(6, perLayer * 1.1), .38, 1);
      const radius = Math.max(20, limits.maxX * fill);
      let best = null;

      for (let i = 0; i < 32; i += 1) {
        const candidate = {
          x: clamp(random(-radius, radius), limits.minX, limits.maxX),
          y: clamp(baseY + random(-38, 30), limits.minY, limits.maxY),
          rotation: this.variedTilt()
        };
        if (!count) Object.assign(candidate, { x: candidate.x * .2, y: limits.maxY });
        const overlaps = this.photos.map(photo => this.overlap(candidate, photo));
        const maxOverlap = overlaps.length ? Math.max(...overlaps) : 0;
        const nearest = count
          ? Math.min(...this.photos.map(photo => Math.hypot(candidate.x - photo.x, candidate.y - photo.y)))
          : 0;
        let score = Math.abs(maxOverlap - .44) * 5;
        if (count && maxOverlap < .3) score += (.3 - maxOverlap) * 9;
        if (maxOverlap > .6) score += (maxOverlap - .6) * 12;
        if (count) score += Math.abs(nearest - CARD_W * .55) / CARD_W;
        score += Math.abs(candidate.y - baseY) / CARD_H;
        score += (1 - fill) * Math.abs(candidate.x) / Math.max(1, limits.maxX);
        score += Math.abs(candidate.x - preferredX) / CARD_W * Math.max(.08, .62 - count * .07);
        if (!best || score < best.score) best = { ...candidate, score };
      }
      return { x: best?.x || 0, y: best?.y ?? limits.maxY, rotation: best?.rotation || 0 };
    }

    render(photo) {
      photo.element.style.setProperty('--x', `${photo.x}px`);
      photo.element.style.setProperty('--y', `${photo.y}px`);
      photo.element.style.setProperty('--r', `${photo.rotation}deg`);
      photo.element.style.setProperty('--s', photo.scale);
    }

    createElement(photo) {
      const element = document.createElement('article');
      element.className = 'polaroid pile-photo falling moving';
      element.setAttribute('aria-hidden', 'true');
      element.innerHTML = `<div class="photo-window"><img src="${photo.image}" alt=""></div>`;
      element.style.zIndex = photo.zIndex;
      this.element.append(element);
      photo.element = element;
      this.render(photo);
    }

    addPhoto(source, sourceRect, onSettled) {
      const pileRect = this.element.getBoundingClientRect();
      const sourceX = sourceRect.left + sourceRect.width / 2 - (pileRect.left + pileRect.width / 2);
      const target = this.landingSpot(sourceX);
      const startRotation = clamp(target.rotation + random(-4, 4), -30, 30);
      const photo = {
        id: this.nextId++,
        image: source.src,
        x: sourceX,
        y: sourceRect.top - pileRect.top,
        rotation: startRotation,
        scale: 1,
        zIndex: this.nextZ++
      };
      const startX = photo.x;
      let driftOne = random(-55, 55);
      let driftTwo = random(-55, 55);
      if (Math.abs(driftOne) < 16) driftOne = sign() * random(16, 40);
      if (Math.sign(driftOne) === Math.sign(driftTwo)) {
        driftTwo = -Math.sign(driftOne) * random(18, 55);
      }
      this.photos.push(photo);
      this.createElement(photo);
      this.motions.set(photo.id, {
        type: 'fall',
        photo,
        startX,
        startY: photo.y,
        driftX1: mix(startX, target.x, .34) + driftOne,
        driftX2: mix(startX, target.x, .7) + driftTwo,
        rotationBase: startRotation,
        rotationSwing: random(1.5, 4),
        windPhase: random(0, Math.PI * 2),
        mass: random(1, 1.24),
        targetX: target.x,
        targetY: target.y,
        targetRotation: target.rotation,
        vx: clamp((target.x - startX) * .62 + random(-24, 24), -300, 300),
        vy: random(445, 520),
        vr: random(-5, 5),
        onSettled
      });
      this.run();
    }

    nearby(landed) {
      const candidates = this.photos
        .filter(photo => photo.id !== landed.id)
        .map(photo => ({
          photo,
          distance: Math.hypot(photo.x - landed.x, photo.y - landed.y),
          overlap: this.overlap(photo, landed)
        }))
        .filter(item => item.overlap > .025 || item.distance < CARD_W * 1.65)
        .sort((a, b) => a.distance - b.distance);
      return candidates.slice(0, Math.min(candidates.length, 3 + Math.floor(Math.random() * 3)));
    }

    displaceNearby(landed) {
      const limits = this.limits();
      this.nearby(landed).forEach(({ photo, distance }, index) => {
        const direction = Math.sign(photo.x - landed.x) || (index % 2 ? 1 : -1);
        const verticalDirection = Math.sign(photo.y - landed.y) || (index % 3 ? -1 : 1);
        const proximity = 1 - clamp(distance / (CARD_W * 1.65), 0, 1);
        this.spring(photo, {
          x: clamp(photo.x + direction * random(42, 105) * (.55 + proximity * .45), limits.minX, limits.maxX),
          y: clamp(photo.y + verticalDirection * random(8, 28), limits.minY, limits.maxY),
          rotation: clamp(photo.rotation + sign() * random(6, 15), -30, 30)
        });
      });
    }

    spring(photo, target, velocity = {}, onSettled) {
      photo.element.classList.add('moving');
      this.motions.set(photo.id, {
        type: 'spring',
        photo,
        targetX: target.x,
        targetY: target.y,
        targetRotation: target.rotation,
        vx: velocity.vx || 0,
        vy: velocity.vy || 0,
        vr: velocity.vr || 0,
        onSettled
      });
      this.run();
    }

    impact(motion) {
      const limits = this.limits();
      const carriedX = clamp(motion.photo.x + motion.vx * .035, limits.minX, limits.maxX);
      const carriedRotation = clamp(motion.photo.rotation + motion.vr * .025, -30, 30);
      const landedCallback = motion.onSettled;
      motion.targetX = carriedX;
      motion.targetRotation = carriedRotation;
      motion.onSettled = null;
      this.displaceNearby(motion.photo);
      motion.type = 'spring';
      motion.photo.element.classList.remove('falling');
      motion.vx *= .08;
      motion.vy = -Math.min(34, Math.abs(motion.vy) * .045);
      motion.vr *= .12;
      motion.photo.y = Math.min(motion.photo.y, motion.targetY);
      landedCallback?.();
    }

    updateFall(motion, dt) {
      const photo = motion.photo;
      const travel = Math.max(1, motion.targetY - motion.startY);
      const progress = clamp((photo.y - motion.startY) / travel, 0, 1);
      let guideX;
      if (progress < .4) {
        guideX = mix(motion.startX, motion.driftX1, smoothstep(progress / .4));
      } else if (progress < .72) {
        guideX = mix(motion.driftX1, motion.driftX2, smoothstep((progress - .4) / .32));
      } else {
        guideX = mix(motion.driftX2, motion.targetX, smoothstep((progress - .72) / .28));
      }

      const wind = Math.sin(progress * Math.PI * 3.4 + motion.windPhase) * 18 * (1 - progress);
      const guidance = mix(1, .42, smoothstep(progress));
      const horizontalForce = ((guideX + wind - photo.x) * 7.2 - motion.vx * 2.8) * guidance;
      motion.vx += horizontalForce / motion.mass * dt;

      const distanceToPile = motion.targetY - photo.y;
      if (progress < .58) {
        motion.vy += (650 - motion.vy * .58) / motion.mass * dt;
      } else {
        const desiredSpeed = clamp(distanceToPile * 1.8, 190, 365);
        motion.vy += (desiredSpeed - motion.vy) * 4.4 / motion.mass * dt;
      }

      const desiredRotation = mix(
        motion.rotationBase + Math.sin(progress * Math.PI * 2.6 + motion.windPhase) * motion.rotationSwing,
        motion.targetRotation,
        smoothstep(clamp((progress - .68) / .32, 0, 1))
      );
      motion.vr += ((desiredRotation - photo.rotation) * 9 - motion.vr * 4.2) / motion.mass * dt;
      motion.vx *= Math.pow(.992, dt * 60);
      motion.vr *= Math.pow(.988, dt * 60);
      photo.x += motion.vx * dt;
      photo.y += motion.vy * dt;
      photo.rotation += motion.vr * dt;
      if (photo.y >= motion.targetY) this.impact(motion);
    }

    updateSpring(motion, dt) {
      const photo = motion.photo;
      const dx = motion.targetX - photo.x;
      const dy = motion.targetY - photo.y;
      const dr = motion.targetRotation - photo.rotation;
      motion.vx += (dx * 132 - motion.vx * 23) * dt;
      motion.vy += (dy * 154 - motion.vy * 25) * dt;
      motion.vr += (dr * 106 - motion.vr * 20) * dt;
      photo.x += motion.vx * dt;
      photo.y += motion.vy * dt;
      photo.rotation += motion.vr * dt;
      if (Math.hypot(dx, dy) < .35 && Math.hypot(motion.vx, motion.vy) < 2.3 &&
          Math.abs(dr) < .12 && Math.abs(motion.vr) < .7) {
        Object.assign(photo, {
          x: motion.targetX,
          y: motion.targetY,
          rotation: motion.targetRotation
        });
        this.render(photo);
        photo.element.classList.remove('moving');
        this.motions.delete(photo.id);
        motion.onSettled?.();
      }
    }

    run() {
      if (!this.frame) {
        this.previousTime = performance.now();
        this.frame = requestAnimationFrame(this.tick);
      }
    }

    tick(time) {
      const dt = Math.min(.032, Math.max(.001, (time - this.previousTime) / 1000));
      this.previousTime = time;
      [...this.motions.values()].forEach(motion => {
        if (motion.type === 'fall') this.updateFall(motion, dt);
        else this.updateSpring(motion, dt);
        this.render(motion.photo);
      });
      if (this.motions.size) this.frame = requestAnimationFrame(this.tick);
      else this.frame = 0;
    }
  }

  const cameraGroups = [
    ['simple-1.png', 'simple-2.png', 'simple-4.png'],
    ['elegant-1.png', 'elegant-2.png'],
    ['macaron-1.png', 'macaron-3.png', 'macaron-5.png', 'macaron-6.png'],
    ['retro-1.png', 'retro-2.png', 'retro-4.png']
  ];
  const cameraThemes = {
    'retro-1.png':['#eee4d8','#8c654b18','#fff8efb8','#dc8842','#fffaf3'],
    'retro-2.png':['#e5e3df','#4d4b4815','#f8f7f4b8','#4b4e53','#f7f6f3'],
    'retro-4.png':['#e3e8df','#54634b16','#f5f8f1b8','#79a866','#f5f9f1'],
    'simple-1.png':['#f5f3ed','#92887312','#ffffffc4','#91969b','#fbfbfa'],
    'simple-2.png':['#f5e8e8','#bd7f8915','#fff7f7ba','#eb8eab','#fff7f8'],
    'simple-4.png':['#f4ead2','#c4944416','#fff8e7b8','#efb63e','#fff9e9'],
    'elegant-1.png':['#e9e8e5','#77746e13','#fbfaf7bc','#999da1','#faf9f6'],
    'elegant-2.png':['#dedfdf','#41454715','#f2f3f3b5','#474b50','#f4f5f5'],
    'macaron-1.png':['#eee9f3','#8974a417','#faf7ffba','#aa8dde','#fbf8ff'],
    'macaron-3.png':['#e6f0f3','#5e94ad16','#f6fcffba','#72b9df','#f5fbfe'],
    'macaron-5.png':['#e9f1e3','#78945c17','#f8fff3ba','#95c878','#f8fff4'],
    'macaron-6.png':['#e7eef1','#718b9816','#f7fcffba','#8fb4c8','#f6fbfd']
  };

  function selectCamera(src, preserveCustomBackground = false) {
    if (!preserveCustomBackground) clearCustomBackground();
    cameraImage.src = `assets/cameras/${src}`;
    const theme = cameraThemes[src];
    ['--paper-base','--paper-fiber','--paper-light','--theme-accent','--button-bg']
      .forEach((name, index) => document.documentElement.style.setProperty(name, theme[index]));
    options.querySelectorAll('.camera-option').forEach(button =>
      button.classList.toggle('selected', button.dataset.camera === src));
  }

  cameraGroups.flat().forEach((src, index) => {
    const button = document.createElement('button');
    button.className = 'camera-option';
    button.type = 'button';
    button.dataset.camera = src;
    button.setAttribute('aria-label', `选择相机 ${index + 1}`);
    button.innerHTML = `<img src="assets/cameras/${src}" alt="">`;
    button.addEventListener('click', () => selectCamera(src));
    options.append(button);
  });
  selectCamera('simple-1.png', true);

  const physics = new PhotoPile(pile);

  function shuffledPhotos() {
    const deck = [...photos];
    for (let index = deck.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
    }
    return deck;
  }

  function ensurePhotoDeck() {
    if (photoDeck.length < 12) photoDeck.push(...shuffledPhotos());
  }

  function loadPhoto(photo) {
    if (photoCache.has(photo.src)) return photoCache.get(photo.src);
    const loading = new Promise(resolve => {
      const loader = new Image();
      loader.decoding = 'async';
      loader.addEventListener('load', async () => {
        try { await loader.decode(); } catch { /* The loaded image is still usable. */ }
        resolve(photo);
      }, { once:true });
      loader.addEventListener('error', () => resolve(photo), { once:true });
      loader.src = photo.src;
    });
    photoCache.set(photo.src, loading);
    return loading;
  }

  function preloadUpcomingPhotos(amount = 10) {
    ensurePhotoDeck();
    photoDeck.slice(0, amount).forEach(loadPhoto);
  }

  function choosePhoto() {
    if (!photos.length) return null;
    ensurePhotoDeck();
    const next = photoDeck.shift();
    preloadUpcomingPhotos();
    return next;
  }

  function showOkWhenReady(token) {
    if (token !== shotToken || !printFinished || !developFinished) return;
    ok.classList.add('show');
    ok.focus({ preventScroll:true });
  }

  function revealPhoto(photo, token) {
    loadPhoto(photo).then(async () => {
      if (token !== shotToken) return;
      image.src = photo.src;
      try { await image.decode(); } catch { /* Browser cache can still supply the image. */ }
      if (token !== shotToken) return;
      image.classList.remove('revealing');
      void image.offsetWidth;
      const onDeveloped = event => {
        if (event.animationName !== 'photo-develop') return;
        image.removeEventListener('animationend', onDeveloped);
        developFinished = true;
        showOkWhenReady(token);
      };
      image.addEventListener('animationend', onDeveloped);
      image.classList.add('revealing');
    });
  }

  function shoot() {
    if (camera.disabled) return;
    current = choosePhoto();
    if (!current) return;
    const token = ++shotToken;
    printFinished = false;
    developFinished = false;
    camera.disabled = true;
    ok.classList.remove('show');
    sheet.classList.remove('ejecting');
    chute.classList.remove('ejecting');
    image.classList.remove('revealing');
    image.removeAttribute('src');
    flash.classList.remove('fire');
    void flash.offsetWidth;
    flash.classList.add('fire');
    revealPhoto(current, token);
    image.alt = current.title || '随机回忆';
    void chute.offsetWidth;
    chute.classList.add('ejecting');
    sheet.classList.add('ejecting');
    if (printListener) sheet.removeEventListener('animationend', printListener);
    printListener = event => {
      if (event.animationName !== 'paper-release') return;
      sheet.removeEventListener('animationend', printListener);
      printListener = null;
      printFinished = true;
      showOkWhenReady(token);
    };
    sheet.addEventListener('animationend', printListener);
  }

  function keepPhoto() {
    if (!current || !ok.classList.contains('show')) return;
    const source = current;
    const sourceRect = sheet.getBoundingClientRect();
    ok.classList.remove('show');
    sheet.classList.remove('ejecting');
    chute.classList.remove('ejecting');
    current = null;
    physics.addPhoto(source, sourceRect, () => {
      camera.disabled = false;
      camera.focus({ preventScroll: true });
    });
  }

  camera.addEventListener('click', shoot);
  ok.addEventListener('click', keepPhoto);
  preloadUpcomingPhotos();
})();
