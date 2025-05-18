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
    selectedDurationIndex: 2, // 默认3分钟
    duration: 180, 
    timeLeft: 180, // 将在 onLoad 中设置
    isPlaying: false,
    isPaused: false, // 为播放/暂停状态添加
    showMood: false,
    moods: ['😐', '😊', '😭'], // 用户心情
    timer: null,
    displayTime: '03:00', 

    animationFrameId: null,
    lastFrameTime: 0,
    breathProgress: 0,
    breathCycleDuration: 6000, // 一次完整呼吸周期的毫秒数
    breathAmplitude: 0.1, // 呼吸的缩放因子
    canvas: null,
    ctx: null,
    canvasCssWidth: 0,
    frameCount: 0,

    targetRingPercent: 0,
    currentRingPercent: 0,
    ringEasingFactor: 0.15, // 圆环缓动因子

    isFireworksActive: false,
    fireworksParticles: [],
    wasPlayingBeforeHide: false, // 用于 onShow/onHide 逻辑
  },

  backgroundAudioManager: null, // 页级变量，用于音频管理器

  onLoad() {
    const initialDurationValue = this.data.availableDurations[this.data.selectedDurationIndex].value;
    this.setData({
      duration: initialDurationValue,
      timeLeft: initialDurationValue, // 初始化 timeLeft
    });
    this._updateDisplayTimeForDuration(initialDurationValue);

    // 初始化 BackgroundAudioManager
    this.backgroundAudioManager = wx.getBackgroundAudioManager();

    this.backgroundAudioManager.onPlay(() => {
      console.log('[BackgroundAudio] Playing');
      // 如果我们处于播放状态但管理器被暂停了（例如被系统暂停），则更新我们的状态
      if (this.data.isPlaying && this.data.isPaused) { // 如果我们的状态是暂停但音频现在正在播放
        this.setData({ isPaused: false });
      } else if (!this.data.isPlaying && !this.data.isPaused) { // 如果我们的状态是停止但音频开始了（例如通过系统控件）
        // 这种情况需要仔细处理，可能不会在没有用户通过应用UI交互的情况下直接将 isPlaying 设置为 true
        // 目前，假设播放主要通过应用UI控制或能正确恢复
      }
    });

    this.backgroundAudioManager.onPause(() => {
      console.log('[BackgroundAudio] Paused');
      // 如果我们处于播放状态并且不是用户有意暂停的，
      // 这可能是系统暂停。如果应用在前台，我们可能需要更新 `isPaused`。
      // 然而，BackgroundAudioManager 的 `paused` 属性是唯一真实来源。
      // 应用的 `isPlaying` 和 `isPaused` 应该驱动UI和计时器。
    });

    this.backgroundAudioManager.onStop(() => {
      console.log('[BackgroundAudio] Stopped');
      // 这是完全停止，不同于暂停。
      // 如果我们的应用认为它正在播放，这意味着外部停止（例如另一个应用获取了音频焦点）
      // 如果发生这种情况，我们可能需要重置我们的状态。
      // 目前，我们假设 stop 是由我们的应用逻辑 (_endCurrentSession, onUnload) 调用的。
    });

    this.backgroundAudioManager.onEnded(() => {
      console.log('[BackgroundAudio] Ended');
      if (this.data.isPlaying && this.backgroundAudioManager.src === 'https://cdn.tutianxia.com/zenflow/zen.mp3') {
        // 如果主要的 zen 音频结束并且我们仍处于播放会话中，则循环播放它。
        console.log('[BackgroundAudio] Looping main zen audio.');
        this.backgroundAudioManager.seek(0); // 跳到开头
        this.backgroundAudioManager.play();  // 再次播放
      }
      // 注意: end.mp3 音效是用 BackgroundAudioManager 播放的，所以它也会触发这个 onEnded。
      // 如果 end.mp3 播放完毕后不想做任何特殊处理（比如循环），这里的逻辑可以保持不变，
      // 因为 _startNewSession 会在开始新会话时重新设置 src 为 zen.mp3。
    });

    this.backgroundAudioManager.onError((res) => {
      console.error('[BackgroundAudio] Error:', res.errMsg, res.errCode);
      // 可能需要重置UI或通知用户
      this.setData({ isPlaying: false, isPaused: false });
      if (this.data.timer) clearInterval(this.data.timer);
      this.setData({ timer: null});
      // 考虑同时停止动画
    });
  },

  onReady() {
    this.initCanvasAndDrawInitialUi(); // 从 initCanvasAndStartAnimation 更改而来
  },

  onShow() {
    console.log('[onShow] Page is shown.');
    if (this.data.ctx) { // 总是重绘，画布可能需要
        this.drawEverything();
    }

    if (this.data.wasPlayingBeforeHide && this.data.timeLeft > 0) {
      // 这意味着当应用被隐藏时，它正在活跃地播放。
      // 我们期望音频和计时器都已继续。
      console.log('[onShow] Resuming active session from background.');
      this.setData({ isPlaying: true, isPaused: false, wasPlayingBeforeHide: false }); // wasPlayingBeforeHide 使用后重置

      if (this.backgroundAudioManager && this.backgroundAudioManager.paused) {
        // 如果系统暂停了音频（例如中断），则恢复它。
        console.log('[onShow] BackgroundAudioManager was paused by system, attempting to resume play.');
        this.backgroundAudioManager.play();
      } else if (!this.backgroundAudioManager || !this.backgroundAudioManager.src) {
        console.warn('[onShow] BackgroundAudioManager not ready or no src, session might not resume correctly.');
      }

      // 检查计时器状态。
      // 如果计时器为null，则意味着它已停止（例如，操作系统干预，尽管我们没有在onHide中为播放状态清除它）。
      if (!this.data.timer && this.data.timeLeft > 0) { // timeLeft > 0 检查以确保会话尚未结束
        console.warn('[onShow] Timer was expected to be running but is null. Restarting timer.');
        const newTimer = setInterval(this.timerTick, 1000);
        this.setData({timer: newTimer});
      } else if (this.data.timer) {
        console.log('[onShow] Timer appears to be running as expected.');
      }
      // else: 计时器为null且timeLeft为0，会话可能在后台结束。

      // 重启动画
      if (!this.data.animationFrameId && this.data.canvas && (this.data.isPlaying || this.data.isFireworksActive)) { // 确保它应该在播放动画
        this.startAnimationLoop();
      }

    } else if (!this.data.isPlaying && this.data.isPaused && this.data.timeLeft > 0) {
      // 此块处理应用被 *用户手动暂停* 然后隐藏，现在再次显示的情况。
      // `wasPlayingBeforeHide` 将为 false，因为 `onHide` 会为暂停状态设置它。
      console.log('[onShow] Session was user-paused when hidden. Remaining in paused state.');
      // 音频应仍处于暂停状态（BackgroundAudioManager的状态）。
      // 计时器应为null（在onHide中为暂停状态清除）。
      // 动画为null。
      this.drawEverything(); // 只需确保为暂停状态重绘UI。

    } else if (this.data.timeLeft <= 0 && !this.data.showMood && !this.data.isFireworksActive) {
      // 会话结束（如果计时器继续，则可能在后台结束）
      console.log('[onShow] Session ended while in background or upon return. Showing mood selection.');
      // 在显示心情选择之前确保会话已完全停止。
      if (this.data.isPlaying || this.data.isPaused) { // 如果它认为仍在播放/暂停但时间已到
          this._endCurrentSession(); // 正确结束它
      } else { // 已经停止，只显示心情。
          this.setData({ showMood: true }); // isPlaying 和 isPaused 应从 _endCurrentSession 中为 false
          if(this.data.ctx) this.drawEverything();
      }
    }
    // 注意: 如果 wasPlayingBeforeHide 为 true，则在第一个 `if` 块内重置。
  },

  onHide() {
    console.log('[onHide] Page is hidden.');
    if (this.data.isPlaying && !this.data.isPaused) {
      // 会话正在活跃地播放。
      console.log('[onHide] Session active and playing. App to background. Audio & Timer should continue. UI animation will pause.');
      this.setData({ wasPlayingBeforeHide: true });
      // 计时器不会被清除，允许它尝试在后台运行。
      // 音频 (BackgroundAudioManager) 继续播放。
    } else {
      // 这包括：
      // 1. 用户暂停了会话 (isPlaying: false, isPaused: true)
      // 2. 会话已经停止 (isPlaying: false, isPaused: false, 例如选择心情后，或初始状态)
      console.log('[onHide] Session was not actively playing (paused or stopped). Ensuring timer is cleared if it exists.');
      this.setData({ wasPlayingBeforeHide: false }); // 隐藏前不是活跃播放状态
      if (this.data.timer) {
        clearInterval(this.data.timer);
        this.setData({ timer: null });
      }
    }

    // 进入后台时总是停止画布动画
    if (this.data.animationFrameId && this.data.canvas) {
      this.data.canvas.cancelAnimationFrame(this.data.animationFrameId);
      this.setData({ animationFrameId: null });
    }
  },

  onUnload() {
    console.log('[onUnload] Page is being unloaded.');
    this.stopAnimationLoop();
    if (this.data.timer) {
      clearInterval(this.data.timer);
      this.setData({ timer: null });
    }
    if (this.backgroundAudioManager) {
      this.backgroundAudioManager.stop(); // 停止后台音频
      // 如果页面被永久销毁，移除监听器是一个好习惯，
      // 但 BackgroundAudioManager 是全局的。在 onLoad 中添加的监听器如果不显式移除可能会持续存在。
      // 为简单起见，我们在这里不移除它们，
      // 假设页面不会频繁重载导致监听器累积。
      // 如果这成为问题，可以考虑移除它们：this.backgroundAudioManager.offPlay(handler) 等。
    }
  },

  initCanvasAndDrawInitialUi() { // 已重命名
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
          lastFrameTime: Date.now(), // 为潜在的第一个动画帧初始化
          targetRingPercent: 0,    // 确保初始状态为0
          currentRingPercent: 0  // 确保初始状态为0
        });
        console.log(`[initCanvas] Canvas initialized. CSS Width: ${this.data.canvasCssWidth}`);
        
        this.drawEverything(); // 绘制初始静态UI，不要启动动画
      });
  },

  handleBreathIndicatorTap() {
    if (this.data.showMood || this.data.isFireworksActive) {
        console.log('[Tap] Interaction blocked by mood selection or fireworks.');
        return; 
    }

    if (!this.backgroundAudioManager) {
      console.error("[handleBreathIndicatorTap] BackgroundAudioManager not initialized!");
      return;
    }

    if (!this.data.isPlaying && !this.data.isPaused) { // 情况1：初始启动或选择心情后重新启动
      console.log('[Tap] Starting new session.');
      this._startNewSession(); // 这将设置src并自动播放
    } else if (this.data.isPlaying && !this.data.isPaused) { // 情况2：播放中 -> 暂停
      console.log('[Tap] Pausing session.');
      this.backgroundAudioManager.pause();
      this.setData({ isPlaying: false, isPaused: true });
      // 如果isPlaying变为false，计时器会在timerTick中清除，或者也应在此处显式清除。
      if (this.data.timer) { // 清除计时器间隔
        clearInterval(this.data.timer);
        this.setData({ timer: null });
      }
      this.drawEverything(); // 在暂停状态下重绘（静态球）
    } else if (!this.data.isPlaying && this.data.isPaused) { // 情况3：暂停 -> 恢复
      console.log('[Tap] Resuming session.');
      this.backgroundAudioManager.play();
      this.setData({ isPlaying: true, isPaused: false });
      
      if (this.data.timer) clearInterval(this.data.timer); // 以防万一，清除旧的
      const newTimer = setInterval(this.timerTick, 1000);
      this.setData({timer: newTimer});

      this.startAnimationLoop(); // 确保动画循环正在运行
    }
  },

  _startNewSession() {
    this.setData({
      isPlaying: true,
      isPaused: false,
      timeLeft: this.data.duration, // 将timeLeft重置为所选的完整时长
      breathProgress: 0,
      lastFrameTime: Date.now(),
      targetRingPercent: 0,
      currentRingPercent: 0,
      showMood: false, // 隐藏心情选择
      isFireworksActive: false, // 确保烟花已关闭
      fireworksParticles: []
    });

    // 配置并启动 BackgroundAudioManager
    if (this.backgroundAudioManager) {
      this.backgroundAudioManager.title = '专注时刻'; // 必需：音频标题
      this.backgroundAudioManager.singer = 'ZenFlow'; // 可选：歌手
      this.backgroundAudioManager.epname = '背景舒缓音乐'; // 可选：专辑名称
      // 可选：封面图片URL。您可能需要托管此图像或使用CDN。
      // this.backgroundAudioManager.coverImgUrl = 'URL_TO_YOUR_COVER_IMAGE.jpg';
      this.backgroundAudioManager.src = 'https://cdn.tutianxia.com/zenflow/zen.mp3'; // 设置src以自动播放
      // 此处不需要显式调用 play()，因为设置 src 会启动播放。
    } else {
      console.error("[_startNewSession] BackgroundAudioManager not initialized!");
      // 如果管理器不可用，则执行回退或错误处理
      this.setData({isPlaying: false}); // 如果无法播放音频，则阻止会话启动
      return;
    }

    if (this.data.timer) clearInterval(this.data.timer);
    const timer = setInterval(this.timerTick, 1000); // 使用绑定函数或单独的函数
    this.setData({ timer: timer });

    this._updateDisplayTimeForDuration(this.data.duration); // 更新当前时长的显示
    this.startAnimationLoop();
  },
  
  timerTick() { // 提取的计时器逻辑
    if (this.data.timeLeft > 0 && this.data.isPlaying && !this.data.isPaused) {
      const newTimeLeft = this.data.timeLeft - 1;
      const newTargetPercent = (this.data.duration > 0) ? (this.data.duration - newTimeLeft) / this.data.duration : 0;
      this.setData({ 
        timeLeft: newTimeLeft,
        targetRingPercent: newTargetPercent 
      });
      this._updateDisplayTimeForDuration(newTimeLeft); // 更新显示时间
    } else if (this.data.timeLeft <= 0 && this.data.isPlaying) { // 确保时间耗尽时它正在播放
      this._endCurrentSession();
    }
  },

  _endCurrentSession() { // 从 endBreathAndAnimation 重命名而来
    console.log('[SessionEnd] Ending current session.');
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

    if (this.backgroundAudioManager) {
        this.backgroundAudioManager.stop(); // 停止当前音频 (zen.mp3)
        // 现在使用 BackgroundAudioManager 播放结束音效
        this.backgroundAudioManager.title = '会话结束'; // 必需的标题
        this.backgroundAudioManager.src = 'https://cdn.tutianxia.com/zenflow/end.mp3'; 
        // 播放将自动开始。循环由 onEnded 检查 src 来处理。
    } else {
      console.error("[_endCurrentSession] BackgroundAudioManager not initialized, cannot play end sound.");
    }

    if (this.data.timer) {
      clearInterval(this.data.timer);
      this.setData({ timer: null });
    }
    
    this.drawEverything(); // 绘制最终状态（完整圆环）

    this.setData({ 
      isFireworksActive: true,
      fireworksParticles: []
    });
    this.launchFireworksSequence();

    if (!this.data.animationFrameId && this.data.canvas && this.data.isFireworksActive) {
      this.startAnimationLoop(); // 用于烟花
    }
  },

  startAnimationLoop() {
    if (this.data.animationFrameId && this.data.canvas) { // 如果存在，清除现有的循环
        this.data.canvas.cancelAnimationFrame(this.data.animationFrameId);
        this.setData({ animationFrameId: null});
    }
    if (!this.data.canvas) {
        console.warn("[startAnimationLoop] Canvas not ready.");
        return;
    }
    const loop = () => {
      // 检查动画是否应继续
      if (!this.data.isPlaying && !this.data.isFireworksActive && !this.data.isPaused) { 
          // 如果不播放、不是烟花且未暂停（例如初始状态或心情选择后），则停止。
          // 但是，如果已暂停，我们可能需要最后一次绘制静态状态，在tap中处理。
          // 这个条件很棘手。更简单：如果设置了ID，循环总是运行。Tap/End 控制启动/停止。
          // 目前，依赖于在需要时显式停止它。
      }
      this.updateAnimationState();
      this.drawEverything();
      if (this.data.isPlaying || this.data.isFireworksActive) { // 仅当活动时才请求新帧
        const newFrameId = this.data.canvas.requestAnimationFrame(loop);
        this.setData({ animationFrameId: newFrameId });
      } else {
        this.setData({animationFrameId: null}); // 如果不循环，确保其为null
      }
    };
    // 仅当播放或烟花活动时才请求第一帧
    if (this.data.isPlaying || this.data.isFireworksActive) {
        const firstFrameId = this.data.canvas.requestAnimationFrame(loop);
        this.setData({ animationFrameId: firstFrameId, lastFrameTime: Date.now() });
    } else {
        // 如果不开始播放，则只绘制一次当前静态状态。
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
    
    if (deltaTime <=0 && (this.data.isPlaying || this.data.isFireworksActive)) return; // 如果deltaTime为0或负数，避免出现问题

    let newBreathProgress = this.data.breathProgress;
    if (this.data.isPlaying && !this.data.isPaused) { // 仅当播放且未暂停时才进行呼吸动画
        newBreathProgress = this.data.breathProgress + (deltaTime / this.data.breathCycleDuration) * (2 * Math.PI);
        if (newBreathProgress >= (2 * Math.PI)) {
            newBreathProgress = newBreathProgress % (2 * Math.PI);
        }
    }

    let newCurrentRingPercent = this.data.currentRingPercent;
    // 如果正在播放或目标已更改（例如暂停时更改时长后），则应发生圆环进度动画
    if (this.data.isPlaying || Math.abs(this.data.targetRingPercent - newCurrentRingPercent) > 0.001 ) {
        const diff = this.data.targetRingPercent - newCurrentRingPercent;
        if (Math.abs(diff) > 0.001) {
            newCurrentRingPercent += diff * this.data.ringEasingFactor * (deltaTime / 16.67); // 使缓动与帧率无关
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
      this.updateFireworks(deltaTime); // 将deltaTime传递给烟花
    }
  },
  
  updateFireworks(deltaTime) { // 添加了deltaTime参数
    const timeScale = deltaTime / 16.67; // 基于理想60fps的缩放因子
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
        // console.warn("[drawEverything] Ctx or canvasCssWidth not ready."); // 可以取消注释以进行调试
        return;
    }

    const ctx = this.data.ctx;
    const cssWidth = this.data.canvasCssWidth;
    const baseRadius = cssWidth * 0.4; // 在此处定义baseRadius以保持一致性
    const centerX = cssWidth / 2;
    const centerY = cssWidth / 2; 

    ctx.clearRect(0, 0, cssWidth, cssWidth);

    // 确定球/环是否应被烟花隐藏
    const hideBallAndRing = this.data.isFireworksActive && this.data.fireworksParticles.length > 10; // 示例阈值

    if (!hideBallAndRing) {
        let currentBreathRadius = baseRadius;
        if (this.data.isPlaying && !this.data.isPaused) { // 仅当播放且未暂停时才进行动画
            const scaleFactor = 1 + Math.sin(this.data.breathProgress) * this.data.breathAmplitude;
            currentBreathRadius = baseRadius * scaleFactor;
        }
        // else: 初始、暂停或结束（在烟花完全接管之前）- 绘制静态球

        ctx.beginPath();
        ctx.arc(centerX, centerY, currentBreathRadius, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fill();

        const percentToDraw = this.data.currentRingPercent;
        const lineWidth = 8;
        const ringRadius = Math.max(5, currentBreathRadius - lineWidth - 5); // 圆环半径
        const shadowBlurBase = 5; // 阴影模糊基数

        if (ringRadius > lineWidth / 2) {
            // 背景环
            ctx.lineWidth = lineWidth;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
            ctx.shadowBlur = shadowBlurBase;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ringRadius, 0, 2 * Math.PI, false);
            ctx.stroke();

            // 前景进度环
            if (percentToDraw > 0.001) { // 仅当有进度时才绘制
                ctx.lineWidth = lineWidth;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
                ctx.shadowBlur = shadowBlurBase + 2;
                ctx.lineCap = 'round'; // 使弧线末端变圆
                ctx.beginPath();
                ctx.arc(centerX, centerY, ringRadius, -Math.PI / 2, -Math.PI / 2 + percentToDraw * 2 * Math.PI, false);
                ctx.stroke();
                ctx.lineCap = 'butt'; // 重置 lineCap
            }
            ctx.shadowBlur = 0; // 重置阴影
            ctx.shadowColor = 'transparent'; // 重置阴影颜色
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
    // 如果没有其他动画在运行，动画循环将自行停止或被停止。
    if (!this.data.isPlaying) {
      // this.stopAnimationLoop(); // 如果 isPlaying 和 isFireworksActive 都为 false，循环应该自行停止。
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
      wx.setStorageSync('trainingHistory', trainingHistory.slice(0, 50)); // 最多保留50条记录
      console.log('[selectMood] Session recorded:', sessionRecord);
    } catch (err) {
      console.error('[selectMood] Failed to save history:', err);
    }
    
    this.setData({
      isPlaying: false,
      isPaused: false,
      showMood: false, 
      isFireworksActive: false, // 确保烟花已停止
      fireworksParticles: [],
      targetRingPercent: 0,
      currentRingPercent: 0,
      timeLeft: this.data.duration, // 为可能的新会话重置timeLeft
    });
    this._updateDisplayTimeForDuration(this.data.duration); // 更新显示
    
    if (this.data.ctx) {
        this.drawEverything(); // 绘制下一会话的初始状态
    }
    // wx.navigateBack(); // 这是用户原始代码中的，如果他们想在选择心情后导航回来。
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
    let newParticles = this.data.fireworksParticles || []; // 确保数组存在
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
    const s = String(Math.max(0, durationInSeconds % 60)).padStart(2, '0'); // 确保秒数非负
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
      // isPlaying 保持 false (如果之前是暂停或未开始状态)
      // isPaused 状态不受时长选择器影响
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