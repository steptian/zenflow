Page({
  data: {
    availableDurations: [
      { text: '30秒', value: 30 },
      { text: '1分钟', value: 60 },
      { text: '3分钟', value: 180 },
      { text: '5分钟', value: 300 },
      { text: '10分钟', value: 600 },
      { text: '15分钟', value: 900 },
      { text: '20分钟', value: 1200 },
      { text: '30分钟', value: 1800 },
    ],
    selectedDurationIndex: 2, // Default to 3 minutes
    duration: 180, 
    timeLeft: 180, // Will be set in onLoad
    isPlaying: false,
    isPaused: false, // Added for play/pause state
    showMood: false,
    moods: ['😐', '😊', '😭'], // User's moods
    audio: null,
    timer: null,
    displayTime: '03:00', 

    animationFrameId: null,
    lastFrameTime: 0,
    breathProgress: 0,
    breathCycleDuration: 6000, // ms for one full cycle
    breathAmplitude: 0.1, // Scale factor for breath
    canvas: null,
    ctx: null,
    canvasCssWidth: 0,
    frameCount: 0,

    targetRingPercent: 0,
    currentRingPercent: 0,
    ringEasingFactor: 0.15,

    isFireworksActive: false,
    fireworksParticles: [],
    wasPlayingBeforeHide: false, // For onShow/onHide logic
  },

  onLoad() {
    const initialDurationValue = this.data.availableDurations[this.data.selectedDurationIndex].value;
    this.setData({
      duration: initialDurationValue,
      timeLeft: initialDurationValue, // Initialize timeLeft
    });
    this._updateDisplayTimeForDuration(initialDurationValue);
  },

  onReady() {
    this.initCanvasAndDrawInitialUi(); // Changed from initCanvasAndStartAnimation
  },

  onShow() {
    console.log('[onShow] Page is shown.');
    if (this.data.ctx) { // Always redraw, canvas might need it
        this.drawEverything();
    }

    if (this.wasPlayingBeforeHide && this.data.timeLeft > 0) { 
      console.log('[onShow] Resuming session from background.');
      this.setData({ isPlaying: true, isPaused: false, wasPlayingBeforeHide: false });
      if (this.data.audio) this.data.audio.play().catch(e => console.error("Audio resume error", e));
      
      // Restart timer explicitly if it was cleared or rely on its existing interval
      if (this.data.timer) clearInterval(this.data.timer); // Clear old one just in case
      const newTimer = setInterval(this.timerTick, 1000);
      this.setData({timer: newTimer});

      if (!this.data.animationFrameId && this.data.canvas) {
        this.startAnimationLoop();
      }
    } else if (this.data.timeLeft <= 0 && !this.data.showMood && !this.data.isFireworksActive) {
      // If session ended while away and mood/fireworks not yet shown
      this.setData({ showMood: true, isPlaying: false, isPaused: false });
      if(this.data.ctx) this.drawEverything();
    }
     this.setData({ wasPlayingBeforeHide: false }); // Reset flag
  },

  onHide() {
    console.log('[onHide] Page is hidden.');
    if (this.data.isPlaying && !this.data.isPaused) { // If actively playing (not user-paused)
      console.log('[onHide] Session was active. Pausing for background.');
      this.setData({ wasPlayingBeforeHide: true }); 
      // Important: Do not set isPlaying to false here. State is "playing but backgrounded".
      if (this.data.audio) this.data.audio.pause();
      if (this.data.timer) { // Stop timer from ticking down further in background
        clearInterval(this.data.timer);
        this.setData({ timer: null });
      }
      if (this.data.animationFrameId && this.data.canvas) {
        this.data.canvas.cancelAnimationFrame(this.data.animationFrameId);
        this.setData({ animationFrameId: null }); 
      }
    }
  },

  onUnload() {
    console.log('[onUnload] Page is being unloaded.');
    this.stopAnimationLoop();
    if (this.data.timer) {
      clearInterval(this.data.timer);
      this.setData({ timer: null });
    }
    if (this.data.audio) {
      this.data.audio.destroy();
      this.setData({ audio: null });
    }
  },

  initCanvasAndDrawInitialUi() { // Renamed
    const query = wx.createSelectorQuery().in(this);
    query.select('#progressCircle')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          console.error('[initCanvas] Canvas node or response not found!');
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;
        const cssWidth = res[0].width;
        const cssHeight = res[0].height;

        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;
        ctx.scale(dpr, dpr);
        
        this.setData({
          canvas: canvas,
          ctx: ctx,
          canvasCssWidth: cssWidth,
          frameCount: 0,
          lastFrameTime: Date.now(), // Initialize for potential first animation frame
          targetRingPercent: 0,    // Ensure 0 for initial state
          currentRingPercent: 0  // Ensure 0 for initial state
        });
        console.log(`[initCanvas] Canvas initialized. CSS Width: ${this.data.canvasCssWidth}`);
        
        this.drawEverything(); // Draw initial static UI, DO NOT start animation
      });
  },

  handleBreathIndicatorTap() {
    if (this.data.showMood || this.data.isFireworksActive) {
        console.log('[Tap] Interaction blocked by mood selection or fireworks.');
        return; 
    }

    if (!this.data.isPlaying && !this.data.isPaused) { // Case 1: Initial start or restart after mood selection
      console.log('[Tap] Starting new session.');
      this._startNewSession();
    } else if (this.data.isPlaying && !this.data.isPaused) { // Case 2: Playing -> Pause
      console.log('[Tap] Pausing session.');
      this.setData({ isPlaying: false, isPaused: true });
      if (this.data.audio) this.data.audio.pause();
      if (this.data.timer) { // Clear timer interval
        clearInterval(this.data.timer);
        this.setData({ timer: null });
      }
      // Animation loop will stop due to isPlaying being false in updateAnimationState
      this.drawEverything(); // Redraw in paused state (static ball)
    } else if (!this.data.isPlaying && this.data.isPaused) { // Case 3: Paused -> Resume
      console.log('[Tap] Resuming session.');
      this.setData({ isPlaying: true, isPaused: false });
      if (this.data.audio) {
        this.data.audio.play();
      } else {
        console.error("[handleBreathIndicatorTap] Audio context not available on resume.");
      }
      
      if (this.data.timer) clearInterval(this.data.timer); // Clear old one just in case
      const newTimer = setInterval(this.timerTick, 1000);
      this.setData({timer: newTimer});

      this.startAnimationLoop(); // Ensure loop is running for animation
    }
  },

  _startNewSession() {
    this.setData({
      isPlaying: true,
      isPaused: false,
      timeLeft: this.data.duration, // Reset timeLeft to full selected duration
      breathProgress: 0,
      lastFrameTime: Date.now(),
      targetRingPercent: 0,
      currentRingPercent: 0,
      showMood: false, // Hide mood selection
      isFireworksActive: false, // Ensure fireworks are off
      fireworksParticles: []
    });

    if (this.data.audio) {
      this.data.audio.destroy(); // Destroy old instance if any
      this.setData({audio: null}); // Clear it from data too
    }
    const audioContext = wx.createInnerAudioContext();
    audioContext.src = '/static/audio/zen.mp3'; 
    audioContext.loop = true;
    
    audioContext.onError((res) => {
        console.error("Audio context error:", res.errMsg, res.errCode);
    });
    
    // Set the audio context to data *before* calling play
    this.setData({ audio: audioContext });

    // Call play on the instance stored in this.data for consistency and safety
    // Removed .catch() as onError is the primary handler for InnerAudioContext
    if (this.data.audio) {
        this.data.audio.play(); 
    } else {
        console.error("_startNewSession: Audio context was not set in data before play.");
    }

    if (this.data.timer) clearInterval(this.data.timer);
    const timer = setInterval(this.timerTick, 1000); // Use a bound or separate function
    this.setData({ timer: timer });

    this._updateDisplayTimeForDuration(this.data.duration); // Update display for current duration
    this.startAnimationLoop();
  },
  
  timerTick() { // Extracted timer logic
    if (this.data.timeLeft > 0 && this.data.isPlaying && !this.data.isPaused) {
      const newTimeLeft = this.data.timeLeft - 1;
      const newTargetPercent = (this.data.duration > 0) ? (this.data.duration - newTimeLeft) / this.data.duration : 0;
      this.setData({ 
        timeLeft: newTimeLeft,
        targetRingPercent: newTargetPercent 
      });
      this._updateDisplayTimeForDuration(newTimeLeft); // Update display time
    } else if (this.data.timeLeft <= 0 && this.data.isPlaying) { // ensure it was playing when time ran out
      this._endCurrentSession();
    }
  },

  _endCurrentSession() { // Renamed from endBreathAndAnimation
    console.log('[SessionEnd] Ending current session.');
    // stopAnimationLoop(); // Loop should stop if isPlaying turns false
    const finalPercent = (this.data.duration > 0) ? 1 : 0;
    this.setData({
      isPlaying: false,
      isPaused: false, 
      showMood: true,
      currentRingPercent: finalPercent, 
      targetRingPercent: finalPercent,
      timeLeft: 0 
    });
    this._updateDisplayTimeForDuration(0);

    if (this.data.audio) {
        this.data.audio.stop();
        // Optional: Destroy the main audio if it won't be reused immediately
        // this.data.audio.destroy(); 
        // this.setData({ audio: null });
    }

    // Play end sound
    const endSound = wx.createInnerAudioContext();
    endSound.src = '/static/audio/end.mp3';
    endSound.play();
    endSound.onError((res) => {
        console.error("End sound error:", res.errMsg, res.errCode);
    });
    // Optional: Destroy on end
    // endSound.onEnded(() => {
    //   endSound.destroy();
    // });

    if (this.data.timer) {
      clearInterval(this.data.timer);
      this.setData({ timer: null });
    }
    
    this.drawEverything(); // Draw final state (full ring)

    this.setData({ 
      isFireworksActive: true,
      fireworksParticles: []
    });
    this.launchFireworksSequence();

    if (!this.data.animationFrameId && this.data.canvas && this.data.isFireworksActive) {
      this.startAnimationLoop(); // For fireworks
    }
  },

  startAnimationLoop() {
    if (this.data.animationFrameId && this.data.canvas) { // Clear existing loop if any
        this.data.canvas.cancelAnimationFrame(this.data.animationFrameId);
        this.setData({ animationFrameId: null});
    }
    if (!this.data.canvas) {
        console.warn("[startAnimationLoop] Canvas not ready.");
        return;
    }
    const loop = () => {
      // Check if animation should continue
      if (!this.data.isPlaying && !this.data.isFireworksActive && !this.data.isPaused) { 
          // If not playing, not fireworks, and not paused (e.g. initial state or after mood), stop.
          // However, if paused, we might want one last draw for the static state, handle in tap.
          // This condition is tricky. Simpler: loop always runs if an ID is set. Tap/End controls starting/stopping.
          // For now, rely on stopping it explicitly when needed.
      }
      this.updateAnimationState();
      this.drawEverything();
      if (this.data.isPlaying || this.data.isFireworksActive) { // Only request new frame if active
        const newFrameId = this.data.canvas.requestAnimationFrame(loop);
        this.setData({ animationFrameId: newFrameId });
      } else {
        this.setData({animationFrameId: null}); // Ensure it's null if not looping
      }
    };
    // Request the first frame only if playing or fireworks active
    if (this.data.isPlaying || this.data.isFireworksActive) {
        const firstFrameId = this.data.canvas.requestAnimationFrame(loop);
        this.setData({ animationFrameId: firstFrameId, lastFrameTime: Date.now() });
    } else {
        // If not starting to play, just draw the current static state once.
        this.drawEverything();
    }
  },

  stopAnimationLoop() {
    if (this.data.animationFrameId && this.data.canvas) {
      this.data.canvas.cancelAnimationFrame(this.data.animationFrameId);
      this.setData({ animationFrameId: null });
      console.log('[stopAnimationLoop] Animation loop stopped.');
    }
  },

  updateAnimationState() {
    const currentTime = Date.now();
    const deltaTime = currentTime - this.data.lastFrameTime;
    
    if (deltaTime <=0 && (this.data.isPlaying || this.data.isFireworksActive)) return; // Avoid issues if deltaTime is 0 or negative

    let newBreathProgress = this.data.breathProgress;
    if (this.data.isPlaying && !this.data.isPaused) { // Breath animation only when playing and not paused
        newBreathProgress = this.data.breathProgress + (deltaTime / this.data.breathCycleDuration) * (2 * Math.PI);
        if (newBreathProgress >= (2 * Math.PI)) {
            newBreathProgress = newBreathProgress % (2 * Math.PI);
        }
    }

    let newCurrentRingPercent = this.data.currentRingPercent;
    // Ring progress animation should occur if playing or if target has changed (e.g. after duration change when paused)
    if (this.data.isPlaying || Math.abs(this.data.targetRingPercent - newCurrentRingPercent) > 0.001 ) {
        const diff = this.data.targetRingPercent - newCurrentRingPercent;
        if (Math.abs(diff) > 0.001) {
            newCurrentRingPercent += diff * this.data.ringEasingFactor * (deltaTime / 16.67); // Make easing frame-rate independent
        } else {
            newCurrentRingPercent = this.data.targetRingPercent;
        }
    }
    
    this.setData({
        breathProgress: newBreathProgress,
        currentRingPercent: newCurrentRingPercent,
        lastFrameTime: currentTime,
        frameCount: this.data.frameCount + 1
    });
    
    if (this.data.isFireworksActive) {
      this.updateFireworks(deltaTime); // Pass deltaTime to fireworks
    }
  },
  
  updateFireworks(deltaTime) { // Added deltaTime parameter
    const timeScale = deltaTime / 16.67; // Scale factor based on ideal 60fps
    const updatedParticles = this.data.fireworksParticles.map(p => {
      p.x += p.vx * timeScale;
      p.y += p.vy * timeScale;
      p.vy += p.gravity * timeScale;
      p.lifespan -= 1 * timeScale; 
      p.opacity = Math.max(0, p.lifespan / p.initialLifespan);
      return p;
    }).filter(p => p.lifespan > 0);

    this.setData({ fireworksParticles: updatedParticles });

    if (updatedParticles.length === 0 && this.data.fireworksParticles.length > 0 && this.data.isFireworksActive) {
        console.log('[updateFireworks] All particles faded, stopping fireworks effect.');
        this.stopFireworks(); 
    }
  },

  drawEverything() {
    if (!this.data.ctx || !this.data.canvasCssWidth) {
        // console.warn("[drawEverything] Ctx or canvasCssWidth not ready.");
        return;
    }

    const ctx = this.data.ctx;
    const cssWidth = this.data.canvasCssWidth;
    const baseRadius = cssWidth * 0.4; // Define baseRadius here for consistency
    const centerX = cssWidth / 2;
    const centerY = cssWidth / 2; 

    ctx.clearRect(0, 0, cssWidth, cssWidth);

    // Determine if ball/ring should be hidden by fireworks
    const hideBallAndRing = this.data.isFireworksActive && this.data.fireworksParticles.length > 10; // Example threshold

    if (!hideBallAndRing) {
        let currentBreathRadius = baseRadius;
        if (this.data.isPlaying && !this.data.isPaused) { // Animate only if playing and not paused
            const scaleFactor = 1 + Math.sin(this.data.breathProgress) * this.data.breathAmplitude;
            currentBreathRadius = baseRadius * scaleFactor;
        }
        // else: Initial, Paused, or Ended (before fireworks fully take over) - draw static ball

        ctx.beginPath();
        ctx.arc(centerX, centerY, currentBreathRadius, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fill();

        const percentToDraw = this.data.currentRingPercent;
        const lineWidth = 8;
        const ringRadius = Math.max(5, currentBreathRadius - lineWidth - 5);
        const shadowBlurBase = 5;

        if (ringRadius > lineWidth / 2) {
            // Background Ring
            ctx.lineWidth = lineWidth;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
            ctx.shadowBlur = shadowBlurBase;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ringRadius, 0, 2 * Math.PI, false);
            ctx.stroke();

            // Foreground Progress Ring
            if (percentToDraw > 0.001) { // Only draw if there's some progress
                ctx.lineWidth = lineWidth;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
                ctx.shadowBlur = shadowBlurBase + 2;
                ctx.lineCap = 'round'; // Make ends of arc round
                ctx.beginPath();
                ctx.arc(centerX, centerY, ringRadius, -Math.PI / 2, -Math.PI / 2 + percentToDraw * 2 * Math.PI, false);
                ctx.stroke();
                ctx.lineCap = 'butt'; // Reset lineCap
            }
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
        }
    }

    if (this.data.isFireworksActive) {
      this.drawFireworks(ctx);
    }
  },

  drawFireworks(ctx) {
    this.data.fireworksParticles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2, false);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.opacity; // 使用粒子自身的透明度
      ctx.fill();
    });
    ctx.globalAlpha = 1.0; // 重置全局透明度
  },

  stopFireworks() {
    console.log('[stopFireworks] Stopping fireworks effect.');
    this.setData({ 
        isFireworksActive: false,
        fireworksParticles: [] 
    });
    // If no other animations are running, animation loop will stop by itself or be stopped.
    if (!this.data.isPlaying) {
      // this.stopAnimationLoop(); // The loop should stop itself if isPlaying and isFireworksActive are both false.
      console.log('[stopFireworks] Animation loop will stop as no other animations are active.');
    }
  },

  selectMood(e) {
    const mood = e.currentTarget.dataset.mood;
    const sessionRecord = {
      date: new Date().toISOString(),
      duration: this.data.duration, 
      mood: mood
    };
    try {
      let trainingHistory = wx.getStorageSync('trainingHistory') || [];
      trainingHistory.unshift(sessionRecord);
      wx.setStorageSync('trainingHistory', trainingHistory.slice(0, 50)); // Keep up to 50 records
      console.log('[selectMood] Session recorded:', sessionRecord);
    } catch (err) {
      console.error('[selectMood] Failed to save history:', err);
    }
    
    this.setData({
      isPlaying: false,
      isPaused: false,
      showMood: false, 
      isFireworksActive: false, // Ensure fireworks are stopped
      fireworksParticles: [],
      targetRingPercent: 0,
      currentRingPercent: 0,
      timeLeft: this.data.duration, // Reset timeLeft for a potential new session
    });
    this._updateDisplayTimeForDuration(this.data.duration); // Update display
    
    if (this.data.ctx) {
        this.drawEverything(); // Draw initial state for next session
    }
    // wx.navigateBack(); // This was in user's original code, if they want to navigate back after mood selection.
  },

  launchFireworksSequence() {
    console.log('[launchFireworksSequence] Starting fireworks...');
    if (!this.data.canvasCssWidth) {
        console.warn('[launchFireworksSequence] canvasCssWidth not available yet.');
        setTimeout(() => this.launchFireworksSequence(), 100);
        return;
    }
    const centerX = this.data.canvasCssWidth / 2;
    const centerY = this.data.canvasCssWidth / 2; 
    const particleCount = 50; 
    const colors = ['#FFD700', '#FF69B4', '#00FFFF', '#7FFF00', '#FF4500', '#FFFFFF'];

    this.createFireworkBurst(centerX, centerY - 30, particleCount, colors); 

    setTimeout(() => {
      if (!this.data.isFireworksActive) return; 
      this.createFireworkBurst(centerX - 60, centerY - 50, particleCount, colors);
    }, 400); 

    setTimeout(() => {
      if (!this.data.isFireworksActive) return;
      this.createFireworkBurst(centerX + 60, centerY - 40, particleCount, colors);
    }, 700); 

    if (!this.data.animationFrameId && this.data.canvas && this.data.isFireworksActive) {
        console.log('[launchFireworksSequence] Ensuring animation loop is running for fireworks.');
        this.startAnimationLoop();
    }
  },

  createFireworkBurst(startX, startY, particleCount, colorOptions) {
    console.log(`[createFireworkBurst] Creating burst at ${startX}, ${startY}`);
    let newParticles = this.data.fireworksParticles || []; // Ensure array exists
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 2.5 + 1; 
      const lifespan = Math.random() * 70 + 50; 
      const size = Math.random() * 2 + 1.5; 

      newParticles.push({
        id: Date.now() + Math.random(), 
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - Math.random() * 1.0, 
        color: colorOptions[Math.floor(Math.random() * colorOptions.length)],
        lifespan: lifespan,
        initialLifespan: lifespan, 
        opacity: 1,
        size: size,
        gravity: 0.03 
      });
    }
    this.setData({ fireworksParticles: newParticles });
  },

  _updateDisplayTimeForDuration(durationInSeconds) {
    const m = String(Math.floor(durationInSeconds / 60)).padStart(2, '0');
    const s = String(Math.max(0, durationInSeconds % 60)).padStart(2, '0'); // Ensure seconds non-negative
    this.setData({ displayTime: `${m}:${s}` });
  },

  bindDurationChange(e) {
    const newIndex = parseInt(e.detail.value, 10);
    if (isNaN(newIndex) || newIndex < 0 || newIndex >= this.data.availableDurations.length) {
        console.error("[bindDurationChange] Invalid index from picker:", e.detail.value);
        return;
    }
    const newDuration = this.data.availableDurations[newIndex].value;
    
    this.setData({
      selectedDurationIndex: newIndex,
      duration: newDuration,
      timeLeft: newDuration, 
      targetRingPercent: 0, 
      currentRingPercent: 0,
      // isPlaying remains false if it was (i.e., if paused or not started)
      // isPaused state remains unchanged by duration picker
      showMood: false, 
      isFireworksActive: false, 
      fireworksParticles: [] 
    });
    this._updateDisplayTimeForDuration(newDuration);

    if (this.data.ctx) {
        this.drawEverything(); 
    }
  },
}) 