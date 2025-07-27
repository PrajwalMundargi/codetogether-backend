'use client';
import { useEffect, useRef, useState } from 'react';

export default function XTerminal({ socket, roomCode }) {
  const terminalRef = useRef(null);
  const term = useRef(null);
  const [isMounted, setIsMounted] = useState(false);
  const [Terminal, setTerminal] = useState(null);
  const [FitAddon, setFitAddon] = useState(null);
  const fitAddonRef = useRef(null);

  // Dynamically import xterm and addons only on client side
  useEffect(() => {
    const loadXTerm = async () => {
      if (typeof window !== 'undefined') {
        const { Terminal } = await import('xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        await import('xterm/css/xterm.css');
        setTerminal(() => Terminal);
        setFitAddon(() => FitAddon);
        setIsMounted(true);
      }
    };

    loadXTerm();
  }, []);

  useEffect(() => {
    if (!isMounted || !terminalRef.current || !socket || !roomCode || !Terminal || !FitAddon) return;

    // Initialize terminal with better configuration
    term.current = new Terminal({
      theme: { 
        background: '#1e1e1e',
        foreground: '#ffffff',
        cursor: '#ffffff',
        selection: '#ffffff40',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff'
      },
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
      rows: 24,
      cols: 80,
      scrollback: 1000,
      allowTransparency: true,
    });

    // Initialize fit addon
    fitAddonRef.current = new FitAddon();
    term.current.loadAddon(fitAddonRef.current);

    term.current.open(terminalRef.current);
    
    // Fit terminal to container
    setTimeout(() => {
      fitAddonRef.current?.fit();
      // Send terminal size to backend
      if (term.current) {
        socket.emit('terminal-resize', { 
          roomCode, 
          cols: term.current.cols, 
          rows: term.current.rows 
        });
      }
    }, 0);

    // Handle terminal input
    term.current.onData((data) => {
      socket.emit('terminal-input', { roomCode, input: data });
    });

    // Handle terminal resize
    term.current.onResize(({ cols, rows }) => {
      socket.emit('terminal-resize', { roomCode, cols, rows });
    });

    // Handle terminal output
    const handleOutput = (data) => {
      if (term.current) {
        term.current.write(data);
      }
    };

    // Handle terminal clear
    const handleClear = () => {
      if (term.current) {
        term.current.clear();
      }
    };

    // Handle terminal info
    const handleTerminalInfo = (info) => {
      console.log('Terminal info:', info);
    };

    // Socket event listeners
    socket.on('terminal-output', handleOutput);
    socket.on('terminal-clear', handleClear);
    socket.on('terminal-info', handleTerminalInfo);

    // Initialize terminal
    socket.emit('terminal-init', { roomCode });

    // Handle window resize
    const resizeHandler = () => {
      setTimeout(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
        }
      }, 100);
    };

    window.addEventListener('resize', resizeHandler);

    // Cleanup
    return () => {
      socket.off('terminal-output', handleOutput);
      socket.off('terminal-clear', handleClear);
      socket.off('terminal-info', handleTerminalInfo);
      window.removeEventListener('resize', resizeHandler);
      term.current?.dispose();
    };
  }, [isMounted, socket, roomCode, Terminal, FitAddon]);

  // Show loading state while xterm is loading
  if (!isMounted || !Terminal) {
    return (
      <div
        style={{
          height: '400px',
          backgroundColor: '#1e1e1e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
          border: '1px solid #333',
          borderRadius: '4px',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '10px' }}>⚡</div>
          <div>Loading terminal...</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '400px',
        backgroundColor: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: '4px',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        ref={terminalRef}
        style={{
          height: '100%',
          width: '100%',
          padding: '8px',
        }}
      />
    </div>
  );
}