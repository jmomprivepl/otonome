import { useState } from 'react';
import { getBezierPath, type EdgeProps } from 'reactflow';
import { useThemeStore } from '../themeStore';

export function AnimatedSVGEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Create unique IDs for our gradient and filter
  const gradientId = `electricity-gradient-${id}`;
  const filterId = `glow-filter-${id}`;
  const maskId = `flow-mask-${id}`;
  
  // Generate a random offset for animation variation
  const [offset] = useState(() => Math.random() * 100);
  
  // Get current theme
  const isDarkMode = useThemeStore((state) => state.isDark);
  
  // Define theme-specific colors
  const startColor = isDarkMode ? '#4facfe' : '#8a5cf6'; // Blue for dark, Purple for light
  const endColor = isDarkMode ? '#4ff2ae' : '#d946ef';   // Cyan for dark, Fuchsia for light
  const baseColor = isDarkMode ? '#0c1a3a' : '#4a1d96';  // Dark blue for dark, Dark purple for light
  const particleColor = isDarkMode ? '#00f2fe' : '#eae8fa'; // Cyan for dark, Magenta for light

  return (
    <>
      <defs>
        {/* Create a glowing filter for the electricity effect */}
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        
        {/* Create a gradient that transitions based on theme */}
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={startColor} />
          <stop offset="50%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={endColor} />
        </linearGradient>
        
        {/* Create a mask for the flowing effect */}
        <mask id={maskId}>
          <path 
            d={edgePath} 
            stroke="white" 
            strokeWidth="4" 
            fill="none" 
            style={{ animation: `flow 1s linear infinite` }}
          />
        </mask>
      </defs>
      
      {/* Base path with glow effect */}
      <path
        d={edgePath}
        stroke={baseColor}
        strokeWidth="3"
        fill="none"
        filter={`url(#${filterId})`}
        style={{ opacity: 0.3 }}
      />
      
      {/* Main electricity path with gradient */}
      <path
        d={edgePath}
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        fill="none"
        style={{ 
          animation: `flow 1.5s linear infinite`,
          animationDelay: `-${offset}ms`
        }}
      />
      
      {/* Pulsing overlay */}
      <path
        d={edgePath}
        stroke="rgba(255, 255, 255, 0.8)"
        strokeWidth="1"
        fill="none"
        style={{ 
          animation: `pulse 2s ease-in-out infinite`,
          animationDelay: `-${offset * 2}ms`
        }}
      />
      
      {/* Flowing particles effect */}
      <g mask={`url(#${maskId})`}>
        <circle r="2" fill="white" filter={`url(#${filterId})`}>
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            path={edgePath}
          />
        </circle>
        <circle r="1.5" fill={particleColor} filter={`url(#${filterId})`}>
          <animateMotion
            dur="3s"
            repeatCount="indefinite"
            path={edgePath}
          />
        </circle>
      </g>
    </>
  );
}