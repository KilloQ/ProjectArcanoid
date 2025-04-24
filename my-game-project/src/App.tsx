import { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Holistic } from '@mediapipe/holistic';
import { Camera } from '@mediapipe/camera_utils';
import type { Results } from '@mediapipe/holistic';

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
};

const App = () => {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);

  const platformXRef = useRef(WIDTH / 2 - PLATFORM_WIDTH / 2);
  const targetXRef = useRef(platformXRef.current);
  const handHistory = useRef<number[]>([]);
  const ballRef = useRef<Ball>({ x: WIDTH / 2, y: HEIGHT / 2, dx: BALL_SPEED, dy: -BALL_SPEED });

  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover' | 'victory'>('menu');
  const [blocks, setBlocks] = useState<Block[]>([]);

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
    ballRef.current = { x: WIDTH / 2, y: HEIGHT / 2, dx: BALL_SPEED, dy: -BALL_SPEED };
    platformXRef.current = WIDTH / 2 - PLATFORM_WIDTH / 2;
    targetXRef.current = platformXRef.current;
    setScore(0);
    setGameState('playing');
  }, [initBlocks]);

  const onResults = useCallback((results: Results) => {
    if (results.poseLandmarks && gameState === 'playing') {
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
  }, [gameState]);

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
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
      platformXRef.current += (targetXRef.current - platformXRef.current) * SMOOTHING_FACTOR;

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

      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      ctx.fillStyle = '#4CAF50';
      ctx.strokeStyle = '#388E3C';
      updatedBlocks.forEach(block => {
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
      ctx.font = '20px Arial';
      ctx.fillText(`Score: ${score}`, 10, 25);

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [gameState, blocks, score]);

  return (
    <div style={{ 
      textAlign: 'center', 
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#f5f5f5',
      minHeight: '100vh',
      padding: '20px'
    }}>
      <Webcam 
        ref={webcamRef} 
        style={{ visibility: 'hidden', position: 'absolute' }} 
      />
      
      <h1 style={{ color: '#333' }}>Arkanoid with Hand Control</h1>
      
      {gameState === 'menu' && (
        <div style={{ margin: '40px 0' }}>
          <p style={{ fontSize: '18px', marginBottom: '30px' }}>
            Move your right hand to control the platform
          </p>
          <button 
            onClick={resetGame}
            style={{
              padding: '12px 30px',
              fontSize: '18px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
              transition: 'background-color 0.3s'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#45a049'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#4CAF50'}
          >
            Start Game
          </button>
        </div>
      )}

      {(gameState === 'gameover' || gameState === 'victory') && (
        <div style={{ 
          margin: '40px 0',
          padding: '20px',
          backgroundColor: 'white',
          borderRadius: '5px',
          display: 'inline-block',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ color: gameState === 'victory' ? '#4CAF50' : '#F44336' }}>
            {gameState === 'victory' ? 'You Win!' : 'Game Over!'}
          </h2>
          <p style={{ fontSize: '24px', margin: '20px 0' }}>
            Your score: <strong>{score}</strong>
          </p>
          <button 
            onClick={resetGame}
            style={{
              padding: '12px 30px',
              fontSize: '18px',
              backgroundColor: gameState === 'victory' ? '#4CAF50' : '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              margin: '10px',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
            }}
          >
            Play Again
          </button>
        </div>
      )}

      <div style={{ margin: '20px auto', display: 'inline-block' }}>
        <canvas 
          ref={canvasRef} 
          width={WIDTH} 
          height={HEIGHT} 
          style={{ 
            border: '2px solid #333',
            borderRadius: '5px',
            backgroundColor: 'white',
            display: gameState === 'playing' ? 'block' : 'none',
            boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
          }} 
        />
      </div>

      {gameState === 'playing' && (
        <div style={{ marginTop: '20px' }}>
          <button 
            onClick={() => setGameState('menu')}
            style={{
              padding: '8px 16px',
              backgroundColor: '#f5f5f5',
              border: '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Back to Menu
          </button>
        </div>
      )}
    </div>
  );
};

export default App;