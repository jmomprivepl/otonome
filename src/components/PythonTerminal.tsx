import React, { useEffect, useRef } from 'react';

export interface PythonTerminalProps {
  output: string;
  className?: string;
}

const PythonTerminal: React.FC<PythonTerminalProps> = ({ output, className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when output updates
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div
      ref={containerRef}
      className={`python-terminal ${className}`}
      style={{
        backgroundColor: '#1e1e1e',
        color: '#d4d4d4',
        fontFamily: 'monospace',
        padding: '10px',
        height: '300px',
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
        borderRadius: '4px',
        border: '1px solid #333'
      }}
    >
      {output}
    </div>
  );
};

export default PythonTerminal;
