import { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Holistic } from '@mediapipe/holistic';
import { Camera } from '@mediapipe/camera_utils';
import type { Results } from '@mediapipe/holistic';
import './index.css';

const WIDTH = 600;
const HEIGHT = 400;

const PLATFORM_WIDTH = 100;
const PLATFORM_HEIGHT = 10;
const PLATFORM_Y = HEIGHT - PLATFORM_HEIGHT - 10;

const BALL_SIZE = 10;
const BALL_SPEED = 5;

const SMOOTHING_FACTOR = 0.3;
const HAND_HISTORY_SIZE = 5;

const BLOCK_WIDTH = 55;
const BLOCK_HEIGHT = 20;
const BLOCK_ROWS = 5;
const BLOCK_COLS = 10;

type Block = {
  x: number;
  y: number;
  isDestroyed: boolean;
};

type Ball = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  isMoving: boolean;
};

const App = () => {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);

  const platformXRef = useRef(WIDTH / 2 - PLATFORM_WIDTH / 2);
  const targetXRef = useRef(platformXRef.current);
  const handHistory = useRef<number[]>([]);
  const ballRef = useRef<Ball>({ 
    x: WIDTH / 2, 
    y: HEIGHT / 2, 
    dx: 0, 
    dy: 0,
    isMoving: false 
  });

  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover' | 'victory'>('menu');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [isPaused, setIsPaused] = useState(false);

  const initBlocks = useCallback(() => {
    return Array.from({ length: BLOCK_ROWS }, (_, rowIndex) =>
      Array.from({ length: BLOCK_COLS }, (_, colIndex) => ({
        x: colIndex * (BLOCK_WIDTH + 5),
        y: rowIndex * (BLOCK_HEIGHT + 5) + 30,
        isDestroyed: false,
      }))
    ).flat();
  }, []);

  const resetGame = useCallback(() => {
    setBlocks(initBlocks());
    ballRef.current = { 
      x: WIDTH / 2, 
      y: HEIGHT / 2, 
      dx: 0, 
      dy: 0,
      isMoving: false 
    };
    platformXRef.current = WIDTH / 2 - PLATFORM_WIDTH / 2;
    targetXRef.current = platformXRef.current;
    setScore(0);
    setGameState('playing');
    setIsPaused(false);
  }, [initBlocks]);

  const launchBall = useCallback(() => {
    if (!ballRef.current.isMoving && gameState === 'playing') {
      ballRef.current = {
        ...ballRef.current,
        dx: BALL_SPEED,
        dy: -BALL_SPEED,
        isMoving: true
      };
    }
  }, [gameState]);

  const togglePause = useCallback(() => {
    if (gameState === 'playing') {
      setIsPaused(prev => !prev);
    }
  }, [gameState]);

  const onResults = useCallback((results: Results) => {
    if (results.poseLandmarks && gameState === 'playing' && !isPaused) {
      const rightHand = results.poseLandmarks[16];
      if (rightHand) {
        let x = rightHand.x * WIDTH;

        handHistory.current.push(x);
        if (handHistory.current.length > HAND_HISTORY_SIZE) {
          handHistory.current.shift();
        }

        const avgX = handHistory.current.reduce((a, b) => a + b, 0) / handHistory.current.length;
        targetXRef.current = Math.max(0, Math.min(WIDTH - PLATFORM_WIDTH, avgX - PLATFORM_WIDTH / 2));
      }
    }
  }, [gameState, isPaused]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        togglePause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePause]);

  useEffect(() => {
    const holistic = new Holistic({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
    });

    holistic.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    holistic.onResults(onResults);

    let camera: Camera | null = null;
    if (webcamRef.current?.video) {
      camera = new Camera(webcamRef.current.video, {
        onFrame: async () => {
          await holistic.send({ image: webcamRef.current!.video! });
        },
      });
      camera.start();
    }

    return () => {
      camera?.stop();
      holistic.close();
    };
  }, [onResults]);

  useEffect(() => {
    if (gameState !== 'playing' || isPaused) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
      platformXRef.current += (targetXRef.current - platformXRef.current) * SMOOTHING_FACTOR;

      if (ballRef.current.isMoving) {
        ballRef.current.x += ballRef.current.dx;
        ballRef.current.y += ballRef.current.dy;

        if (ballRef.current.x <= 0 || ballRef.current.x + BALL_SIZE >= WIDTH) {
          ballRef.current.dx *= -1;
        }
        if (ballRef.current.y <= 0) {
          ballRef.current.dy *= -1;
        }

        if (ballRef.current.y + BALL_SIZE >= PLATFORM_Y &&
            ballRef.current.x + BALL_SIZE >= platformXRef.current &&
            ballRef.current.x <= platformXRef.current + PLATFORM_WIDTH) {
          const hitPoint = (ballRef.current.x + BALL_SIZE / 2) - (platformXRef.current + PLATFORM_WIDTH / 2);
          const normalized = hitPoint / (PLATFORM_WIDTH / 2);
          const angle = normalized * (Math.PI / 3);
          const speed = Math.sqrt(ballRef.current.dx ** 2 + ballRef.current.dy ** 2);
          ballRef.current.dx = speed * Math.sin(angle);
          ballRef.current.dy = -Math.abs(speed * Math.cos(angle));
          ballRef.current.y = PLATFORM_Y - BALL_SIZE;
        }

        let destroyedCount = 0;
        const updatedBlocks = blocks.map(block => {
          if (!block.isDestroyed) {
            if (ballRef.current.x + BALL_SIZE > block.x &&
                ballRef.current.x < block.x + BLOCK_WIDTH &&
                ballRef.current.y + BALL_SIZE > block.y &&
                ballRef.current.y < block.y + BLOCK_HEIGHT) {
              
              const ballCenter = {
                x: ballRef.current.x + BALL_SIZE / 2,
                y: ballRef.current.y + BALL_SIZE / 2
              };
              const blockCenter = {
                x: block.x + BLOCK_WIDTH / 2,
                y: block.y + BLOCK_HEIGHT / 2
              };

              const dx = ballCenter.x - blockCenter.x;
              const dy = ballCenter.y - blockCenter.y;
              const width = (BALL_SIZE + BLOCK_WIDTH) / 2;
              const height = (BALL_SIZE + BLOCK_HEIGHT) / 2;
              const crossWidth = width * dy;
              const crossHeight = height * dx;

              if (Math.abs(dx) <= width && Math.abs(dy) <= height) {
                if (crossWidth > crossHeight) {
                  ballRef.current.dy *= -1;
                } else {
                  ballRef.current.dx *= -1;
                }
                destroyedCount++;
                return { ...block, isDestroyed: true };
              }
            }
          }
          return block;
        });

        if (destroyedCount > 0) {
          setBlocks(updatedBlocks);
          setScore(prev => prev + destroyedCount * 10);
        }

        if (updatedBlocks.every(block => block.isDestroyed)) {
          setGameState('victory');
          return;
        }

        if (ballRef.current.y > HEIGHT) {
          setGameState('gameover');
          return;
        }
      }

      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      ctx.fillStyle = '#4CAF50';
      ctx.strokeStyle = '#388E3C';
      blocks.forEach(block => {
        if (!block.isDestroyed) {
          ctx.fillRect(block.x, block.y, BLOCK_WIDTH, BLOCK_HEIGHT);
          ctx.strokeRect(block.x, block.y, BLOCK_WIDTH, BLOCK_HEIGHT);
        }
      });

      ctx.fillStyle = '#2196F3';
      ctx.fillRect(platformXRef.current, PLATFORM_Y, PLATFORM_WIDTH, PLATFORM_HEIGHT);

      ctx.fillStyle = '#FF5722';
      ctx.beginPath();
      ctx.arc(ballRef.current.x, ballRef.current.y, BALL_SIZE, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#000';
      ctx.font = '20px Calibri';
      ctx.fillText(`Очки: ${score}`, 10, 25);


      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [gameState, blocks, score, isPaused]);

  return (
    <div className="app-container">
      <Webcam 
        ref={webcamRef} 
        className="webcam" 
      />
      
      <h1 className="title">Арканоид с управлением рукой</h1>
      
      {gameState === 'menu' && (
        <div className="menu-container">
          <p className="instructions">
            Перемещайте правой рукой для движения платформы
          </p>
          <button 
            onClick={resetGame}
            className="start-button"
          >
            Начать игру
          </button>
        </div>
      )}

      {(gameState === 'gameover' || gameState === 'victory') && (
        <div className="result-container">
          <h2 className={`result-title ${gameState === 'victory' ? 'victory' : 'gameover'}`}>
            {gameState === 'victory' ? 'Вы победили!' : 'Игра окончена!'}
          </h2>
          <p className="score-display">
            Ваш счет: <strong>{score}</strong>
          </p>
          <button 
            onClick={resetGame}
            className={`restart-button ${gameState === 'victory' ? 'victory' : 'gameover'}`}
          >
            Начать заново
          </button>
        </div>
      )}

      <div className="canvas-container">
        <canvas 
          ref={canvasRef} 
          width={WIDTH} 
          height={HEIGHT} 
          className={`game-canvas ${gameState === 'playing' ? 'visible' : 'hidden'}`}
          onClick={launchBall}
        />
      </div>

      {gameState === 'playing' && (
        <div className="game-controls">
          <button 
            onClick={togglePause}
            className="pause-button"
          >
            {isPaused ? 'Продолжить' : 'Пауза'}
          </button>
          <button 
            onClick={() => setGameState('menu')}
            className="menu-button"
          >
            Вернуться в меню
          </button>
        </div>
      )}
    </div>
  );
};

export default App;