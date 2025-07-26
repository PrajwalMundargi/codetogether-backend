const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const os = require('os');

class TerminalManager {
  constructor() {
    this.terminals = new Map(); // Store PTY sessions by roomCode
    this.workingDirectories = new Map(); // Store working directories by roomCode
  }

  // Initialize terminal for a room
  initializeTerminal(roomCode, socket) {
    if (!this.terminals.has(roomCode)) {
      // Create working directory for this room
      const workDir = path.join(os.tmpdir(), `compiler_${roomCode}`);
      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
      }
      
      this.workingDirectories.set(roomCode, workDir);
      
      // Determine shell based on OS
      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      
      // Create PTY process
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: workDir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          FORCE_COLOR: '1'
        }
      });

      // Store the PTY process
      this.terminals.set(roomCode, ptyProcess);

      // Handle PTY data output
      ptyProcess.onData((data) => {
        socket.emit('terminal-output', data);
      });

      // Handle PTY exit
      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`Terminal ${roomCode} exited with code: ${exitCode}, signal: ${signal}`);
        this.terminals.delete(roomCode);
        socket.emit('terminal-output', `\r\n\x1b[31mTerminal session ended\x1b[0m\r\n`);
      });

      // Send welcome message
      const welcomeMessage = `\x1b[32m✓ Terminal initialized for room: ${roomCode}\x1b[0m\r\n`;
      socket.emit('terminal-output', welcomeMessage);
    }
  }

  // Handle terminal input
  handleInput(roomCode, input, socket) {
    const ptyProcess = this.terminals.get(roomCode);
    if (!ptyProcess) {
      socket.emit('terminal-output', '\x1b[31mError: Terminal not initialized\x1b[0m\r\n');
      return;
    }

    // Send input directly to PTY
    ptyProcess.write(input);
  }

  // Handle terminal resize
  handleResize(roomCode, cols, rows, socket) {
    const ptyProcess = this.terminals.get(roomCode);
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows);
      } catch (error) {
        console.error('Error resizing terminal:', error);
      }
    }
  }

  // Execute command programmatically
  executeCommand(roomCode, command, socket) {
    const ptyProcess = this.terminals.get(roomCode);
    if (!ptyProcess) {
      socket.emit('terminal-output', '\x1b[31mError: Terminal not initialized\x1b[0m\r\n');
      return;
    }

    // Write command to PTY
    ptyProcess.write(command + '\r');
  }

  // Clear terminal
  clearTerminal(roomCode, socket) {
    const ptyProcess = this.terminals.get(roomCode);
    if (ptyProcess) {
      // Send clear command
      ptyProcess.write('clear\r');
    }
  }

  // Kill current process (Ctrl+C)
  killProcess(roomCode, socket) {
    const ptyProcess = this.terminals.get(roomCode);
    if (ptyProcess) {
      ptyProcess.write('\x03'); // Send Ctrl+C
    }
  }

  // Install package helper
  installPackage(roomCode, packageManager, packageName, socket) {
    const commands = {
      npm: `npm install ${packageName}`,
      yarn: `yarn add ${packageName}`,
      pip: `pip install ${packageName}`,
      pip3: `pip3 install ${packageName}`,
      apt: `sudo apt install ${packageName}`,
      brew: `brew install ${packageName}`
    };

    const command = commands[packageManager];
    if (command) {
      this.executeCommand(roomCode, command, socket);
    } else {
      socket.emit('terminal-output', `\x1b[31mUnsupported package manager: ${packageManager}\x1b[0m\r\n`);
    }
  }

  // Run file helper
  runFile(roomCode, filePath, socket) {
    const workDir = this.workingDirectories.get(roomCode);
    const fullPath = path.resolve(workDir, filePath);
    const ext = path.extname(filePath).toLowerCase();

    const runCommands = {
      '.js': `node ${filePath}`,
      '.py': `python ${filePath}`,
      '.java': `javac ${filePath} && java ${path.basename(filePath, '.java')}`,
      '.cpp': `g++ ${filePath} -o ${path.basename(filePath, '.cpp')} && ./${path.basename(filePath, '.cpp')}`,
      '.c': `gcc ${filePath} -o ${path.basename(filePath, '.c')} && ./${path.basename(filePath, '.c')}`,
      '.go': `go run ${filePath}`,
      '.rs': `rustc ${filePath} && ./${path.basename(filePath, '.rs')}`,
      '.php': `php ${filePath}`,
      '.rb': `ruby ${filePath}`,
      '.sh': `bash ${filePath}`,
      '.ps1': `powershell ${filePath}`
    };

    const command = runCommands[ext];
    if (command) {
      this.executeCommand(roomCode, command, socket);
    } else {
      socket.emit('terminal-output', `\x1b[31mUnsupported file type: ${ext}\x1b[0m\r\n`);
    }
  }

  // Create project structure
  createProject(roomCode, projectType, projectName, socket) {
    const workDir = this.workingDirectories.get(roomCode);
    const projectPath = path.join(workDir, projectName);

    try {
      fs.mkdirSync(projectPath, { recursive: true });

      switch (projectType) {
        case 'node':
          this.executeCommand(roomCode, `cd ${projectName} && npm init -y`, socket);
          break;
        case 'python':
          fs.writeFileSync(path.join(projectPath, 'main.py'), '# Python project\nprint("Hello, World!")\n');
          fs.writeFileSync(path.join(projectPath, 'requirements.txt'), '# Add your dependencies here\n');
          break;
        case 'react':
          this.executeCommand(roomCode, `npx create-react-app ${projectName}`, socket);
          break;
        case 'express':
          this.executeCommand(roomCode, `cd ${projectName} && npm init -y && npm install express`, socket);
          break;
        default:
          socket.emit('terminal-output', `\x1b[31mUnsupported project type: ${projectType}\x1b[0m\r\n`);
      }
    } catch (error) {
      socket.emit('terminal-output', `\x1b[31mError creating project: ${error.message}\x1b[0m\r\n`);
    }
  }

  // Get terminal info
  getTerminalInfo(roomCode) {
    const ptyProcess = this.terminals.get(roomCode);
    const workDir = this.workingDirectories.get(roomCode);
    
    if (ptyProcess) {
      return {
        pid: ptyProcess.pid,
        workingDirectory: workDir,
        shell: ptyProcess.process,
        cols: ptyProcess.cols,
        rows: ptyProcess.rows
      };
    }
    return null;
  }

  // Cleanup terminal session
  cleanup(roomCode) {
    const ptyProcess = this.terminals.get(roomCode);
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch (error) {
        console.error('Error killing PTY process:', error);
      }
    }
    this.terminals.delete(roomCode);
    this.workingDirectories.delete(roomCode);
  }

  // Get all active terminals
  getActiveTerminals() {
    return Array.from(this.terminals.keys());
  }
}

// Socket.IO integration
function setupTerminalHandlers(io) {
  const terminalManager = new TerminalManager();

  io.on('connection', (socket) => {
    console.log('Terminal client connected:', socket.id);

    // Initialize terminal
    socket.on('terminal-init', ({ roomCode }) => {
      console.log(`Initializing terminal for room: ${roomCode}`);
      terminalManager.initializeTerminal(roomCode, socket);
    });

    // Handle terminal input
    socket.on('terminal-input', ({ roomCode, input }) => {
      terminalManager.handleInput(roomCode, input, socket);
    });

    // Handle terminal resize
    socket.on('terminal-resize', ({ roomCode, cols, rows }) => {
      terminalManager.handleResize(roomCode, cols, rows, socket);
    });

    // Execute command
    socket.on('execute-command', ({ roomCode, command }) => {
      terminalManager.executeCommand(roomCode, command, socket);
    });

    // Clear terminal
    socket.on('clear-terminal', ({ roomCode }) => {
      terminalManager.clearTerminal(roomCode, socket);
    });

    // Kill process
    socket.on('kill-process', ({ roomCode }) => {
      terminalManager.killProcess(roomCode, socket);
    });

    // Install package
    socket.on('install-package', ({ roomCode, packageManager, packageName }) => {
      terminalManager.installPackage(roomCode, packageManager, packageName, socket);
    });

    // Run file
    socket.on('run-file', ({ roomCode, filePath }) => {
      terminalManager.runFile(roomCode, filePath, socket);
    });

    // Create project
    socket.on('create-project', ({ roomCode, projectType, projectName }) => {
      terminalManager.createProject(roomCode, projectType, projectName, socket);
    });

    // Get terminal info
    socket.on('get-terminal-info', ({ roomCode }) => {
      const info = terminalManager.getTerminalInfo(roomCode);
      socket.emit('terminal-info', info);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('Terminal client disconnected:', socket.id);
      // Note: You might want to track which rooms this socket was in
      // and cleanup accordingly based on your application logic
    });

    // Handle room cleanup
    socket.on('cleanup-terminal', ({ roomCode }) => {
      terminalManager.cleanup(roomCode);
    });
  });

  return terminalManager;
}

module.exports = { TerminalManager, setupTerminalHandlers };