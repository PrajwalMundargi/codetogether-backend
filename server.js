import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/authRoutes.js';
import connectDB from './database/database.js';
import pty from 'node-pty';
import fs from 'fs';
import path from 'path';
import os from 'os';
import chokidar from 'chokidar';
import roomModel from './models/roomModel.js';
import bcrypt from 'bcrypt';

const app = express();

// Enhanced CORS configuration
app.use(cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// Create HTTP server first
const server = http.createServer(app);

// Add routes after CORS
app.use('/api/auth', authRoutes);

// Enhanced Socket.IO configuration with better error handling
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true,
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Enhanced Terminal Manager Class with Better Sync Control
class TerminalManager {
    constructor() {
        this.terminals = new Map(); // Store PTY sessions by userId
        this.sharedWorkingDirectories = new Map(); // Store shared working directories by roomCode
        this.fileWatchers = new Map(); // Store file watchers by roomCode
        this.userRooms = new Map(); // Track which room each user is in
        this.fileSyncInProgress = new Set(); // Track files being synced to prevent loops
        this.fileWriteQueue = new Map(); // Queue for file writes to prevent conflicts
    }

    // Initialize terminal for a specific user
    initializeTerminal(roomCode, userId) {
        if (!this.terminals.has(userId)) {
            // Create or get shared working directory for this room
            let workDir = this.sharedWorkingDirectories.get(roomCode);
            if (!workDir) {
                workDir = path.join(os.tmpdir(), `compiler_${roomCode}`);
                if (!fs.existsSync(workDir)) {
                    fs.mkdirSync(workDir, { recursive: true });
                }
                this.sharedWorkingDirectories.set(roomCode, workDir);
                
                // Set up file system watcher for the room (only once per room)
                this.setupFileWatcher(roomCode, workDir);
            }
            
            // Track user's room
            this.userRooms.set(userId, roomCode);
            
            // Determine shell based on OS
            const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
            
            try {
                // Create PTY process for this specific user
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

                // Store the PTY process by userId
                this.terminals.set(userId, ptyProcess);

                // Handle PTY data output - send only to the specific user
                ptyProcess.onData((data) => {
                    io.to(userId).emit('terminal-output', data);
                });

                // Handle PTY exit
                ptyProcess.onExit(({ exitCode, signal }) => {
                    console.log(`Terminal ${userId} exited with code: ${exitCode}, signal: ${signal}`);
                    this.terminals.delete(userId);
                    io.to(userId).emit('terminal-output', `\r\n\x1b[31mTerminal session ended\x1b[0m\r\n`);
                    
                    // Restart terminal automatically for this user
                    setTimeout(() => {
                        this.initializeTerminal(roomCode, userId);
                    }, 1000);
                });

                // Send welcome message only to this user
                const welcomeMessage = `\x1b[32m✓ Terminal initialized for room: ${roomCode}\x1b[0m\r\n`;
                io.to(userId).emit('terminal-output', welcomeMessage);
                
                // Sync existing files from roomFiles to working directory
                setTimeout(() => {
                    this.syncRoomFilesToWorkingDir(roomCode);
                }, 500);
            } catch (error) {
                console.error(`Error initializing terminal for user ${userId}:`, error);
                io.to(userId).emit('terminal-output', '\x1b[31mError: Failed to initialize terminal\x1b[0m\r\n');
            }
        }
    }

    // Setup file system watcher with better debouncing
    setupFileWatcher(roomCode, workDir) {
        if (this.fileWatchers.has(roomCode)) {
            return;
        }

        try {
            const watcher = chokidar.watch(workDir, {
                ignored: /^\./, 
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: {
                    stabilityThreshold: 500,
                    pollInterval: 100
                }
            });

            watcher
                .on('add', (filePath) => {
                    const relativePath = path.relative(workDir, filePath);
                    console.log(`File ${relativePath} has been added to ${roomCode}`);
                    this.syncFileFromTerminalToRoom(roomCode, relativePath, filePath);
                })
                .on('change', (filePath) => {
                    const relativePath = path.relative(workDir, filePath);
                    console.log(`File ${relativePath} has been changed in terminal for ${roomCode}`);
                    this.syncFileFromTerminalToRoom(roomCode, relativePath, filePath);
                })
                .on('unlink', (filePath) => {
                    const relativePath = path.relative(workDir, filePath);
                    console.log(`File ${relativePath} has been removed from ${roomCode}`);
                    this.removeFileFromRoomFiles(roomCode, relativePath);
                })
                .on('addDir', (dirPath) => {
                    const relativePath = path.relative(workDir, dirPath);
                    if (relativePath && relativePath !== '.') {
                        console.log(`Directory ${relativePath} has been added to ${roomCode}`);
                        this.syncFolderFromTerminalToRoom(roomCode, relativePath);
                    }
                })
                .on('unlinkDir', (dirPath) => {
                    const relativePath = path.relative(workDir, dirPath);
                    if (relativePath && relativePath !== '.') {
                        console.log(`Directory ${relativePath} has been removed from ${roomCode}`);
                        this.removeFolderFromRoomFiles(roomCode, relativePath);
                    }
                });

            this.fileWatchers.set(roomCode, watcher);
        } catch (error) {
            console.error(`Error setting up file watcher for room ${roomCode}:`, error);
        }
    }

    // Sync file from terminal to room (when changed via terminal)
    syncFileFromTerminalToRoom(roomCode, fileName, filePath) {
        const syncKey = `terminal-${roomCode}-${fileName}`;
        
        if (this.fileSyncInProgress.has(syncKey)) {
            return;
        }
        
        this.fileSyncInProgress.add(syncKey);
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const extension = path.extname(fileName).slice(1) || 'txt';
            
            if (!roomFiles[roomCode]) {
                roomFiles[roomCode] = {};
            }
            
            // Only update if content actually changed
            const currentContent = roomFiles[roomCode][fileName]?.content || '';
            if (currentContent !== content) {
                roomFiles[roomCode][fileName] = {
                    content: content,
                    type: 'file',
                    extension: extension,
                    isExpanded: false
                };
                
                // Emit updates to all clients in the room
                io.to(roomCode).emit('files-update', roomFiles[roomCode]);
                io.to(roomCode).emit('file-synced', { fileName, content });
                
                console.log(`File ${fileName} synced from terminal to room ${roomCode}`);
            }
        } catch (error) {
            console.error(`Error syncing file ${fileName} from terminal to room ${roomCode}:`, error);
        } finally {
            setTimeout(() => {
                this.fileSyncInProgress.delete(syncKey);
            }, 300);
        }
    }

    // Sync folder from terminal to room
    syncFolderFromTerminalToRoom(roomCode, folderPath) {
        const syncKey = `terminal-folder-${roomCode}-${folderPath}`;
        
        if (this.fileSyncInProgress.has(syncKey)) {
            return;
        }
        
        this.fileSyncInProgress.add(syncKey);
        
        try {
            if (!roomFiles[roomCode]) {
                roomFiles[roomCode] = {};
            }
            
            if (!roomFiles[roomCode][folderPath]) {
                roomFiles[roomCode][folderPath] = {
                    type: 'folder',
                    isExpanded: false
                };
                
                // Emit updates to all clients in the room
                io.to(roomCode).emit('files-update', roomFiles[roomCode]);
                io.to(roomCode).emit('folder-created', { folderPath });
                
                console.log(`Folder ${folderPath} synced from terminal to room ${roomCode}`);
            }
        } catch (error) {
            console.error(`Error syncing folder ${folderPath} from terminal to room ${roomCode}:`, error);
        } finally {
            setTimeout(() => {
                this.fileSyncInProgress.delete(syncKey);
            }, 300);
        }
    }

    // Remove file from roomFiles when deleted from working directory
    removeFileFromRoomFiles(roomCode, fileName) {
        if (roomFiles[roomCode] && roomFiles[roomCode][fileName]) {
            delete roomFiles[roomCode][fileName];
            
            // If this was someone's active file, switch them to another file
            const remainingFiles = Object.keys(roomFiles[roomCode]).filter(key => 
                roomFiles[roomCode][key].type === 'file'
            );
            if (remainingFiles.length > 0) {
                const newActiveFile = remainingFiles[0];
                
                rooms[roomCode].forEach(userId => {
                    if (userActiveFiles[userId] === fileName) {
                        userActiveFiles[userId] = newActiveFile;
                        io.to(userId).emit('file-content-update', {
                            fileName: newActiveFile,
                            content: roomFiles[roomCode][newActiveFile].content
                        });
                        io.to(userId).emit('active-file-changed', { fileName: newActiveFile });
                    }
                });
            }
            
            io.to(roomCode).emit('files-update', roomFiles[roomCode]);
            io.to(roomCode).emit('item-deleted', { itemPath: fileName, type: 'file' });
            
            console.log(`File ${fileName} removed from room ${roomCode}`);
        }
    }

    // Remove folder from roomFiles when deleted from working directory
    removeFolderFromRoomFiles(roomCode, folderPath) {
        if (roomFiles[roomCode]) {
            // Remove folder and all its contents
            const keysToDelete = Object.keys(roomFiles[roomCode]).filter(key => 
                key === folderPath || key.startsWith(folderPath + '/')
            );
            
            keysToDelete.forEach(key => {
                delete roomFiles[roomCode][key];
            });
            
            io.to(roomCode).emit('files-update', roomFiles[roomCode]);
            io.to(roomCode).emit('item-deleted', { itemPath: folderPath, type: 'folder' });
            
            console.log(`Folder ${folderPath} and its contents removed from room ${roomCode}`);
        }
    }

    // Sync all files from roomFiles to working directory (when editor changes files)
    syncRoomFilesToWorkingDir(roomCode) {
        const workDir = this.sharedWorkingDirectories.get(roomCode);
        if (!workDir || !roomFiles[roomCode]) return;

        Object.keys(roomFiles[roomCode]).forEach(itemPath => {
            const itemData = roomFiles[roomCode][itemPath];
            if (itemData.type === 'file') {
                this.writeFileToWorkingDir(roomCode, itemPath, itemData.content);
            } else if (itemData.type === 'folder') {
                this.createFolderInWorkingDir(roomCode, itemPath);
            }
        });
    }

    // Create folder in working directory
    createFolderInWorkingDir(roomCode, folderPath) {
        const workDir = this.sharedWorkingDirectories.get(roomCode);
        if (!workDir) return false;

        try {
            const fullPath = path.join(workDir, folderPath);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
                console.log(`Folder ${folderPath} created in working directory for room ${roomCode}`);
            }
            return true;
        } catch (error) {
            console.error(`Error creating folder ${folderPath} in working directory:`, error);
            return false;
        }
    }

    // Write single file to working directory with better sync control
    writeFileToWorkingDir(roomCode, fileName, content) {
        const syncKey = `editor-${roomCode}-${fileName}`;
        
        if (this.fileSyncInProgress.has(syncKey)) {
            return true;
        }
        
        this.fileSyncInProgress.add(syncKey);
        
        const workDir = this.sharedWorkingDirectories.get(roomCode);
        if (!workDir) {
            this.fileSyncInProgress.delete(syncKey);
            return false;
        }

        try {
            const filePath = path.join(workDir, fileName);
            const fileDir = path.dirname(filePath);
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(fileDir)) {
                fs.mkdirSync(fileDir, { recursive: true });
            }
            
            // Only write if content has changed
            let shouldWrite = true;
            if (fs.existsSync(filePath)) {
                const currentContent = fs.readFileSync(filePath, 'utf8');
                shouldWrite = currentContent !== content;
            }
            
            if (shouldWrite) {
                fs.writeFileSync(filePath, content);
                console.log(`File ${fileName} written to working directory for room ${roomCode}`);
            }
            
            return true;
        } catch (error) {
            console.error(`Error writing file ${fileName} to working directory:`, error);
            return false;
        } finally {
            setTimeout(() => {
                this.fileSyncInProgress.delete(syncKey);
            }, 300);
        }
    }

    // Handle terminal input for a specific user
    handleInput(userId, input) {
        const ptyProcess = this.terminals.get(userId);
        if (!ptyProcess) {
            io.to(userId).emit('terminal-output', '\x1b[31mError: Terminal not initialized\x1b[0m\r\n');
            return;
        }
        ptyProcess.write(input);
    }

    // Handle terminal resize for a specific user
    handleResize(userId, cols, rows) {
        const ptyProcess = this.terminals.get(userId);
        if (ptyProcess) {
            try {
                ptyProcess.resize(cols, rows);
            } catch (error) {
                console.error('Error resizing terminal:', error);
            }
        }
    }

    // Execute command programmatically for a specific user
    executeCommand(userId, command) {
        const ptyProcess = this.terminals.get(userId);
        if (!ptyProcess) {
            io.to(userId).emit('terminal-output', '\x1b[31mError: Terminal not initialized\x1b[0m\r\n');
            return;
        }
        ptyProcess.write(command + '\r');
    }

    // Run file helper for a specific user
    runFile(userId, fileName) {
        const roomCode = this.userRooms.get(userId);
        const workDir = this.sharedWorkingDirectories.get(roomCode);
        
        if (!workDir) {
            io.to(userId).emit('terminal-output', '\x1b[31mError: Working directory not found\x1b[0m\r\n');
            return;
        }

        const ext = path.extname(fileName).toLowerCase();
        
        const runCommands = {
            '.js': `node ${fileName}`,
            '.py': `python ${fileName}`,
            '.java': `javac ${fileName} && java ${path.basename(fileName, '.java')}`,
            '.cpp': `g++ ${fileName} -o ${path.basename(fileName, '.cpp')} && ./${path.basename(fileName, '.cpp')}`,
            '.c': `gcc ${fileName} -o ${path.basename(fileName, '.c')} && ./${path.basename(fileName, '.c')}`,
            '.go': `go run ${fileName}`,
            '.rs': `rustc ${fileName} && ./${path.basename(fileName, '.rs')}`,
            '.php': `php ${fileName}`,
            '.rb': `ruby ${fileName}`,
            '.sh': `bash ${fileName}`,
            '.ps1': `powershell ${fileName}`
        };

        const command = runCommands[ext];
        if (command) {
            this.executeCommand(userId, command);
        } else {
            io.to(userId).emit('terminal-output', `\x1b[31mUnsupported file type: ${ext}\x1b[0m\r\n`);
        }
    }

    // Cleanup terminal session for a specific user
    cleanupUser(userId) {
        const ptyProcess = this.terminals.get(userId);
        if (ptyProcess) {
            try {
                ptyProcess.kill();
            } catch (error) {
                console.error('Error killing PTY process:', error);
            }
            this.terminals.delete(userId);
        }
        
        this.userRooms.delete(userId);
    }

    // Cleanup entire room (when no users left)
    cleanupRoom(roomCode) {
        // Clean up file watcher
        const watcher = this.fileWatchers.get(roomCode);
        if (watcher) {
            try {
                watcher.close();
            } catch (error) {
                console.error('Error closing file watcher:', error);
            }
            this.fileWatchers.delete(roomCode);
        }
        
        // Clean up working directory
        const workDir = this.sharedWorkingDirectories.get(roomCode);
        if (workDir && fs.existsSync(workDir)) {
            try {
                fs.rmSync(workDir, { recursive: true, force: true });
            } catch (error) {
                console.error('Error cleaning up working directory:', error);
            }
        }
        
        this.sharedWorkingDirectories.delete(roomCode);
        
        // Clean up any terminals for users in this room
        for (const [userId, userRoomCode] of this.userRooms.entries()) {
            if (userRoomCode === roomCode) {
                this.cleanupUser(userId);
            }
        }
    }

    // Get working directory for a room
    getWorkingDirectory(roomCode) {
        return this.sharedWorkingDirectories.get(roomCode);
    }
}

// Initialize Terminal Manager
const terminalManager = new TerminalManager();

// Room management variables
const rooms = {};
const roomFiles = {};
const userActiveFiles = {};
const userSession = new Map();

const getDefaultFiles = () => ({
    'main.js': {
        content: '// start typing...',
        type: 'file',
        extension: 'js',
        isExpanded: false
    }
});

// Socket.IO connection handling with error handling
io.on('connection', (socket) => {
    console.log("Socket connected:", socket.id);

    // Handle connection errors
    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
    });

    socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', socket.id, 'Reason:', reason);
    });

    socket.on('create-room', async ({username, password}, callback) => {
        try {
            const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
            
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);

            const newRoom = new roomModel({
                roomCode,
                password: hashedPassword
            });

            await newRoom.save();

            rooms[roomCode] = [socket.id];
            roomFiles[roomCode] = getDefaultFiles();
            userActiveFiles[socket.id] = 'main.js';

            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.username = username;

            // Send initial data to the creator
            socket.emit('room-created', { roomCode });
            socket.emit('files-update', roomFiles[roomCode]);
            socket.emit('file-content-update', {
                fileName: 'main.js',
                content: roomFiles[roomCode]['main.js'].content
            });
            socket.emit('active-file-changed', { fileName: 'main.js' });

            // Initialize terminal for this specific user
            terminalManager.initializeTerminal(roomCode, socket.id);
            
            callback({ success: true, roomCode });
            console.log(`${username} created room ${roomCode}`);
        } catch (error) {
            console.error('Error creating room:', error);
            callback({ success: false, error: 'Failed to create room' });
        }
    });

    socket.on('join-room', async({ username, roomCode, password }, callback) => {
        console.log(`${username} attempting to join room: ${roomCode}`);

        try {
            const room = await roomModel.findOne({ roomCode });
            
            if(!room){
                return callback({
                    success: false,
                    error: 'Room not found. Please check the room code.'
                });
            }

            const isPasswordValid = await bcrypt.compare(password, room.password);
            if(!isPasswordValid){
                return callback({
                    success: false,
                    error:'Invalid password. Please try again.'
                })
            }

            userSession.set(socket.id, {
                roomCode: roomCode,
                username: username,
                joined: new Date()
            })

            // If room doesn't exist in memory, create it
            if (!rooms[roomCode]) {
                console.log(`Room ${roomCode} not found in memory, creating it...`);
                rooms[roomCode] = [];
                roomFiles[roomCode] = getDefaultFiles();
            }
            
            // Check if user is already in the room
            if (rooms[roomCode].includes(socket.id)) {
                console.log(`User ${socket.id} already in room ${roomCode}`);
                return callback({ success: true });
            }
            
            rooms[roomCode].push(socket.id);
            socket.join(roomCode);
            
            socket.roomCode = roomCode;
            socket.username = username;

            // Set default active file for this user
            const fileKeys = Object.keys(roomFiles[roomCode]).filter(key => 
                roomFiles[roomCode][key].type === 'file'
            );
            const firstFile = fileKeys[0];
            userActiveFiles[socket.id] = firstFile;
            
            // Initialize terminal for this specific user
            terminalManager.initializeTerminal(roomCode, socket.id);
            
            // Notify other users in the room
            socket.to(roomCode).emit('user-joined', { username, userId: socket.id });
            
            // Send success response with initial data
            callback({ 
                success: true, 
                message: `Successfully joined room ${roomCode}`,
                files: roomFiles[roomCode],
                activeFile: firstFile
            });
            
            console.log(`${username} joined room ${roomCode}`);
            
        } catch (error) {
            console.error('Error joining room:', error);
            callback({
                success: false,
                error: 'Server error occurred while joining room.'
            });
        }
    });

    // Handle client's initial file fetch requests
    socket.on('get-files', ({ roomCode }, callback) => {
        console.log(`Getting files for room: ${roomCode}`);
        const files = roomFiles[roomCode] || {};
        callback({ files });
    });

    socket.on('get-file-content', ({ roomCode, fileName }, callback) => {
        console.log(`Getting content for file: ${fileName} in room: ${roomCode}`);
        const fileEntry = roomFiles[roomCode]?.[fileName];
        const content = fileEntry && fileEntry.type === 'file' ? fileEntry.content : '';
        callback({ content });
    });

    // Terminal events
    socket.on('terminal-init', ({ roomCode }) => {
        console.log(`Initializing terminal for user ${socket.id} in room: ${roomCode}`);
        terminalManager.initializeTerminal(roomCode, socket.id);
    });

    socket.on('terminal-input', ({ roomCode, input }) => {
        terminalManager.handleInput(socket.id, input);
    });

    socket.on('terminal-resize', ({ roomCode, cols, rows }) => {
        terminalManager.handleResize(socket.id, cols, rows);
    });

    socket.on('execute-command', ({ roomCode, command }) => {
        terminalManager.executeCommand(socket.id, command);
    });

    socket.on('run-file', ({ roomCode, fileName }) => {
        if (roomFiles[roomCode] && roomFiles[roomCode][fileName] && roomFiles[roomCode][fileName].type === 'file') {
            // Ensure file is written to working directory before running
            terminalManager.writeFileToWorkingDir(roomCode, fileName, roomFiles[roomCode][fileName].content);
            terminalManager.runFile(socket.id, fileName);
        } else {
            io.to(socket.id).emit('terminal-output', `\x1b[31mError: File ${fileName} not found\x1b[0m\r\n`);
        }
    });

    socket.on('save-and-run', ({ roomCode, fileName }) => {
        const targetFileName = fileName || userActiveFiles[socket.id];
        if (targetFileName && roomFiles[roomCode] && roomFiles[roomCode][targetFileName] && roomFiles[roomCode][targetFileName].type === 'file') {
            terminalManager.writeFileToWorkingDir(roomCode, targetFileName, roomFiles[roomCode][targetFileName].content);
            terminalManager.runFile(socket.id, targetFileName);
        }
    });

    socket.on('clear-terminal', ({ roomCode }) => {
        terminalManager.executeCommand(socket.id, 'clear');
    });

    socket.on('kill-process', ({ roomCode }) => {
        const ptyProcess = terminalManager.terminals.get(socket.id);
        if (ptyProcess) {
            ptyProcess.write('\x03'); // Send Ctrl+C
        }
    });

    socket.on('get-working-directory', ({ roomCode }, callback) => {
        const workDir = terminalManager.getWorkingDirectory(roomCode);
        callback({ workingDirectory: workDir });
    });

    // Enhanced File Management Events with Folder Support

    // Create File
    socket.on('create-file', ({ roomCode, fileName, parentFolder = '' }) => {
        console.log(`Creating file: ${fileName} in folder: ${parentFolder} for room: ${roomCode}`);
        
        if (!roomFiles[roomCode]) {
            roomFiles[roomCode] = {};
        }
        
        const fullPath = parentFolder ? `${parentFolder}/${fileName}` : fileName;
        
        if (roomFiles[roomCode][fullPath]) {
            socket.emit('file-error', { message: 'File already exists' });
            return;
        }
        
        const extension = fileName.split('.').pop() || 'txt';
        
        roomFiles[roomCode][fullPath] = {
            content: getDefaultContent(extension),
            type: 'file',
            extension: extension,
            isExpanded: false
        };
        
        // Write to working directory
        terminalManager.writeFileToWorkingDir(roomCode, fullPath, roomFiles[roomCode][fullPath].content);
        
        io.to(roomCode).emit('files-update', roomFiles[roomCode]);
        io.to(roomCode).emit('file-created', { fileName: fullPath });
        
        console.log(`File ${fullPath} created in room ${roomCode}`);
    });

    // Create Folder
    socket.on('create-folder', ({ roomCode, folderName, parentFolder = '' }) => {
        console.log(`Creating folder: ${folderName} in parent: ${parentFolder} for room: ${roomCode}`);
        
        if (!roomFiles[roomCode]) {
            roomFiles[roomCode] = {};
        }
        
        const fullPath = parentFolder ? `${parentFolder}/${folderName}` : folderName;
        
        if (roomFiles[roomCode][fullPath]) {
            socket.emit('file-error', { message: 'Folder already exists' });
            return;
        }
        
        roomFiles[roomCode][fullPath] = {
            type: 'folder',
            isExpanded: false
        };
        
        // Create folder in working directory
        terminalManager.createFolderInWorkingDir(roomCode, fullPath);
        
        io.to(roomCode).emit('files-update', roomFiles[roomCode]);
        io.to(roomCode).emit('folder-created', { folderPath: fullPath });
        
        console.log(`Folder ${fullPath} created in room ${roomCode}`);
    });

    // Delete Item (File or Folder)
    socket.on('delete-item', ({ roomCode, itemPath }) => {
        console.log(`Deleting item: ${itemPath} in room: ${roomCode}`);
        
        if (!roomFiles[roomCode] || !roomFiles[roomCode][itemPath]) {
            socket.emit('file-error', { message: 'Item not found' });
            return;
        }
        
        const itemType = roomFiles[roomCode][itemPath].type;
        
        // For files, check if it's the last file
        if (itemType === 'file') {
            const fileCount = Object.keys(roomFiles[roomCode]).filter(key => 
                roomFiles[roomCode][key].type === 'file'
            ).length;
            if (fileCount <= 1) {
                socket.emit('file-error', { message: 'Cannot delete the last file' });
                return;
            }
        }
        
        // Get all items to delete (for folders, include all contents)
        const itemsToDelete = [];
        if (itemType === 'folder') {
            // Delete folder and all its contents
            itemsToDelete.push(...Object.keys(roomFiles[roomCode]).filter(key => 
                key === itemPath || key.startsWith(itemPath + '/')
            ));
        } else {
            itemsToDelete.push(itemPath);
        }
        
        // Delete from working directory
        const workDir = terminalManager.getWorkingDirectory(roomCode);
        if (workDir) {
            itemsToDelete.forEach(item => {
                const fullPath = path.join(workDir, item);
                try {
                    if (fs.existsSync(fullPath)) {
                        const stats = fs.statSync(fullPath);
                        if (stats.isDirectory()) {
                            fs.rmSync(fullPath, { recursive: true, force: true });
                        } else {
                            fs.unlinkSync(fullPath);
                        }
                    }
                } catch (error) {
                    console.error(`Error deleting ${item} from working directory:`, error);
                }
            });
        }
        
        // Delete from roomFiles
        itemsToDelete.forEach(item => {
            delete roomFiles[roomCode][item];
        });
        
        // Handle active file switching if deleted file was active
        if (itemType === 'file' || itemsToDelete.includes(userActiveFiles[socket.id])) {
            const remainingFiles = Object.keys(roomFiles[roomCode]).filter(key => 
                roomFiles[roomCode][key].type === 'file'
            );
            
            if (remainingFiles.length > 0) {
                const newActiveFile = remainingFiles[0];
                
                rooms[roomCode].forEach(userId => {
                    if (itemsToDelete.includes(userActiveFiles[userId])) {
                        userActiveFiles[userId] = newActiveFile;
                        io.to(userId).emit('file-content-update', {
                            fileName: newActiveFile,
                            content: roomFiles[roomCode][newActiveFile].content
                        });
                        io.to(userId).emit('active-file-changed', { fileName: newActiveFile });
                    }
                });
            }
        }
        
        io.to(roomCode).emit('files-update', roomFiles[roomCode]);
        io.to(roomCode).emit('item-deleted', { itemPath, type: itemType });
        
        console.log(`${itemType} ${itemPath} deleted from room ${roomCode}`);
    });

    // Rename Item (File or Folder)
    socket.on('rename-item', ({ roomCode, oldPath, newPath }) => {
        console.log(`Renaming item: ${oldPath} to ${newPath} in room: ${roomCode}`);
        
        if (!roomFiles[roomCode] || !roomFiles[roomCode][oldPath]) {
            socket.emit('file-error', { message: 'Item not found' });
            return;
        }
        
        if (roomFiles[roomCode][newPath]) {
            socket.emit('file-error', { message: 'Item with new name already exists' });
            return;
        }
        
        const itemType = roomFiles[roomCode][oldPath].type;
        
        // Rename in working directory
        const workDir = terminalManager.getWorkingDirectory(roomCode);
        if (workDir) {
            const oldFullPath = path.join(workDir, oldPath);
            const newFullPath = path.join(workDir, newPath);
            try {
                if (fs.existsSync(oldFullPath)) {
                    // Create parent directory if it doesn't exist
                    const newDir = path.dirname(newFullPath);
                    if (!fs.existsSync(newDir)) {
                        fs.mkdirSync(newDir, { recursive: true });
                    }
                    fs.renameSync(oldFullPath, newFullPath);
                }
            } catch (error) {
                console.error('Error renaming item in working directory:', error);
                socket.emit('file-error', { message: 'Failed to rename item in working directory' });
                return;
            }
        }
        
        if (itemType === 'folder') {
            // For folders, we need to rename the folder and all its contents
            const itemsToRename = Object.keys(roomFiles[roomCode]).filter(key => 
                key === oldPath || key.startsWith(oldPath + '/')
            ).sort();
            
            // Create new entries
            itemsToRename.forEach(itemPath => {
                const relativePath = itemPath === oldPath ? '' : itemPath.substring(oldPath.length + 1);
                const newItemPath = relativePath ? `${newPath}/${relativePath}` : newPath;
                
                roomFiles[roomCode][newItemPath] = { ...roomFiles[roomCode][itemPath] };
                
                // Update active files for users
                rooms[roomCode].forEach(userId => {
                    if (userActiveFiles[userId] === itemPath) {
                        userActiveFiles[userId] = newItemPath;
                        io.to(userId).emit('active-file-changed', { fileName: newItemPath });
                    }
                });
            });
            
            // Delete old entries
            itemsToRename.forEach(itemPath => {
                delete roomFiles[roomCode][itemPath];
            });
        } else {
            // For files, simple rename
            roomFiles[roomCode][newPath] = { ...roomFiles[roomCode][oldPath] };
            
            // Update extension if changed
            const newExtension = newPath.split('.').pop() || 'txt';
            roomFiles[roomCode][newPath].extension = newExtension;
            
            delete roomFiles[roomCode][oldPath];
            
            // Update active files for users
            rooms[roomCode].forEach(userId => {
                if (userActiveFiles[userId] === oldPath) {
                    userActiveFiles[userId] = newPath;
                    io.to(userId).emit('active-file-changed', { fileName: newPath });
                }
            });
        }
        
        io.to(roomCode).emit('files-update', roomFiles[roomCode]);
        io.to(roomCode).emit('item-renamed', { oldPath, newPath, type: itemType });
        
        console.log(`${itemType} ${oldPath} renamed to ${newPath} in room ${roomCode}`);
    });

    // Move Item (File or Folder)
    socket.on('move-item', ({ roomCode, sourcePath, targetPath, itemType }) => {
        console.log(`Moving ${itemType}: ${sourcePath} to ${targetPath} in room: ${roomCode}`);
        
        if (!roomFiles[roomCode] || !roomFiles[roomCode][sourcePath]) {
            socket.emit('file-error', { message: 'Source item not found' });
            return;
        }
        
        // Prevent moving a folder into itself
        if (itemType === 'folder' && targetPath.startsWith(sourcePath + '/')) {
            socket.emit('file-error', { message: 'Cannot move a folder into itself' });
            return;
        }
        
        if (roomFiles[roomCode][targetPath]) {
            socket.emit('file-error', { message: 'Target location already exists' });
            return;
        }
        
        // Move in working directory
        const workDir = terminalManager.getWorkingDirectory(roomCode);
        if (workDir) {
            const sourceFullPath = path.join(workDir, sourcePath);
            const targetFullPath = path.join(workDir, targetPath);
            try {
                if (fs.existsSync(sourceFullPath)) {
                    // Create parent directory if it doesn't exist
                    const targetDir = path.dirname(targetFullPath);
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
                    }
                    fs.renameSync(sourceFullPath, targetFullPath);
                }
            } catch (error) {
                console.error('Error moving item in working directory:', error);
                socket.emit('file-error', { message: 'Failed to move item in working directory' });
                return;
            }
        }
        
        if (itemType === 'folder') {
            // For folders, move the folder and all its contents
            const itemsToMove = Object.keys(roomFiles[roomCode]).filter(key => 
                key === sourcePath || key.startsWith(sourcePath + '/')
            ).sort();
            
            // Create new entries
            itemsToMove.forEach(itemPath => {
                const relativePath = itemPath === sourcePath ? '' : itemPath.substring(sourcePath.length + 1);
                const newItemPath = relativePath ? `${targetPath}/${relativePath}` : targetPath;
                
                roomFiles[roomCode][newItemPath] = { ...roomFiles[roomCode][itemPath] };
                
                // Update active files for users
                rooms[roomCode].forEach(userId => {
                    if (userActiveFiles[userId] === itemPath) {
                        userActiveFiles[userId] = newItemPath;
                        io.to(userId).emit('active-file-changed', { fileName: newItemPath });
                    }
                });
            });
            
            // Delete old entries
            itemsToMove.forEach(itemPath => {
                delete roomFiles[roomCode][itemPath];
            });
        } else {
            // For files, simple move
            roomFiles[roomCode][targetPath] = { ...roomFiles[roomCode][sourcePath] };
            delete roomFiles[roomCode][sourcePath];
            
            // Update active files for users
            rooms[roomCode].forEach(userId => {
                if (userActiveFiles[userId] === sourcePath) {
                    userActiveFiles[userId] = targetPath;
                    io.to(userId).emit('active-file-changed', { fileName: targetPath });
                }
            });
        }
        
        io.to(roomCode).emit('files-update', roomFiles[roomCode]);
        io.to(roomCode).emit('item-moved', { sourcePath, targetPath, itemType });
        
        console.log(`${itemType} ${sourcePath} moved to ${targetPath} in room ${roomCode}`);
    });

    // Toggle Folder Expand/Collapse
    socket.on('toggle-folder', ({ roomCode, folderPath }) => {
        console.log(`Toggling folder: ${folderPath} in room: ${roomCode}`);
        
        if (!roomFiles[roomCode] || !roomFiles[roomCode][folderPath] || roomFiles[roomCode][folderPath].type !== 'folder') {
            socket.emit('file-error', { message: 'Folder not found' });
            return;
        }
        
        const currentState = roomFiles[roomCode][folderPath].isExpanded || false;
        roomFiles[roomCode][folderPath].isExpanded = !currentState;
        
        io.to(roomCode).emit('files-update', roomFiles[roomCode]);
        io.to(roomCode).emit('folder-toggled', { 
            folderPath, 
            isExpanded: roomFiles[roomCode][folderPath].isExpanded 
        });
        
        console.log(`Folder ${folderPath} toggled to ${roomFiles[roomCode][folderPath].isExpanded ? 'expanded' : 'collapsed'} in room ${roomCode}`);
    });

    // Switch File (for file selection)
    socket.on('switch-file', ({ roomCode, fileName }) => {
        console.log(`User ${socket.id} switching to file: ${fileName} in room: ${roomCode}`);
        
        if (!roomFiles[roomCode] || !roomFiles[roomCode][fileName] || roomFiles[roomCode][fileName].type !== 'file') {
            socket.emit('file-error', { message: 'File not found' });
            return;
        }
        
        userActiveFiles[socket.id] = fileName;
        
        socket.emit('file-content-update', {
            fileName: fileName,
            content: roomFiles[roomCode][fileName].content
        });
        
        socket.emit('active-file-changed', { fileName: fileName });
        
        console.log(`User ${socket.id} switched to file ${fileName} in room ${roomCode}`);
    });

    // Real-time code change handler
    socket.on('code-change', ({ roomCode, code, fileName }) => {
        console.log(`Code change in room ${roomCode}, file ${fileName || 'current'} from user ${socket.id}`);
        
        const targetFileName = fileName || userActiveFiles[socket.id];
        
        if (!targetFileName) {
            console.log('No active file found for user');
            return;
        }
        
        if (roomFiles[roomCode] && roomFiles[roomCode][targetFileName] && roomFiles[roomCode][targetFileName].type === 'file') {
            // Update the file content immediately
            roomFiles[roomCode][targetFileName].content = code;
            
            // Write to working directory for terminal use (async to avoid blocking)
            setImmediate(() => {
                terminalManager.writeFileToWorkingDir(roomCode, targetFileName, code);
            });
            
            // Broadcast to ALL other users in the room immediately
            socket.to(roomCode).emit('code-update', { 
                code, 
                fileName: targetFileName,
                fromUser: socket.id 
            });
            
            console.log(`Code updated and broadcasted for file ${targetFileName} in room ${roomCode}`);
        } else {
            console.log(`File ${targetFileName} not found in room ${roomCode}`);
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Clean up user session
        userSession.delete(socket.id);
        
        // Clean up user's terminal
        terminalManager.cleanupUser(socket.id);
        
        // Remove user from rooms
        for (const roomCode in rooms) {
            const userIndex = rooms[roomCode].indexOf(socket.id);
            if (userIndex !== -1) {
                rooms[roomCode].splice(userIndex, 1);
                
                // Notify other users in the room
                socket.to(roomCode).emit('user-left', { 
                    username: socket.username,
                    userId: socket.id 
                });
                
                // If room is empty, clean up the room
                if (rooms[roomCode].length === 0) {
                    terminalManager.cleanupRoom(roomCode);
                    delete rooms[roomCode];
                    delete roomFiles[roomCode];
                    console.log(`Room ${roomCode} cleaned up - no users remaining`);
                }
            }
        }
        
        // Clean up user's active file
        delete userActiveFiles[socket.id];
    });
});

// Add error handling for Socket.IO server
io.engine.on("connection_error", (err) => {
    console.log("Socket.IO connection error:", err.req);
    console.log("Error code:", err.code);
    console.log("Error message:", err.message);
    console.log("Error context:", err.context);
});

// Helper function to get default content based on file extension
function getDefaultContent(extension) {
    const templates = {
        'js': '// JavaScript file\nconsole.log("Hello, World!");',
        'jsx': 'import React from "react";\n\nfunction Component() {\n  return <div>Hello, World!</div>;\n}\n\nexport default Component;',
        'ts': '// TypeScript file\nconst message: string = "Hello, World!";\nconsole.log(message);',
        'tsx': 'import React from "react";\n\ninterface Props {}\n\nconst Component: React.FC<Props> = () => {\n  return <div>Hello, World!</div>;\n};\n\nexport default Component;',
        'py': '# Python file\nprint("Hello, World!")',
        'html': '<!DOCTYPE html>\n<html>\n<head>\n    <title>Document</title>\n</head>\n<body>\n    <h1>Hello, World!</h1>\n</body>\n</html>',
        'css': '/* CSS file */\nbody {\n    margin: 0;\n    padding: 0;\n    font-family: Arial, sans-serif;\n}',
        'json': '{\n  "name": "example",\n  "version": "1.0.0"\n}',
        'md': '# Markdown File\n\nHello, World!',
        'txt': 'Hello, World!'
    };
    
    return templates[extension] || '// New file\n';
}

const startServer = async () => {
    try {
        await connectDB();
        const PORT = process.env.PORT || 5000;
        
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Enhanced terminal support with file sync enabled`);
            console.log(`Full folder management support added`);
            console.log(`Socket.IO server ready for connections`);
        });

        // Handle server errors
        server.on('error', (error) => {
            console.error('Server error:', error);
        });

    } catch (err) {
        console.error("Error starting server:", err);
        process.exit(1);
    }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

startServer();