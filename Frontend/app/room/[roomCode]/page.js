'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io } from 'socket.io-client';
import Editor from '@monaco-editor/react';
import XTerminal from '../../Components/XTerminal';

function CollaborativeIDE() {
    const [code, setCode] = useState('// Loading...');
    const [socket, setSocket] = useState(null);
    const [files, setFiles] = useState({});
    const [activeFile, setActiveFile] = useState(null);
    const [showFileExplorer, setShowFileExplorer] = useState(true);
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, fileName: null });
    const [newFileName, setNewFileName] = useState('');
    const [isCreatingFile, setIsCreatingFile] = useState(false);
    const [isRenaming, setIsRenaming] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [workingDirectory, setWorkingDirectory] = useState('');
    const [isSocketConnected, setIsSocketConnected] = useState(false);
    const [isRoomJoined, setIsRoomJoined] = useState(false);
    const [connectedUsers, setConnectedUsers] = useState([]);
    const [connectionStatus, setConnectionStatus] = useState('Checking authentication...');
    const [reconnectAttempts, setReconnectAttempts] = useState(0);
    
    // Authentication states
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [authData, setAuthData] = useState(null);
    const [isAuthChecking, setIsAuthChecking] = useState(true);

    const params = useParams();
    const router = useRouter();
    const roomCode = params.roomCode;

    const isUpdatingFromServer = useRef(false);
    const codeUpdateTimeoutRef = useRef(null);
    const socketRef = useRef(null);

    // Authentication check - CRITICAL FIX
    useEffect(() => {
        const checkAuthentication = () => {
            console.log('Checking room authentication...');
            
            try {
                const authString = sessionStorage.getItem('roomAuth');
                if (!authString) {
                    console.log('No authentication data found');
                    setConnectionStatus('Authentication required');
                    setTimeout(() => {
                        router.push('/');
                    }, 2000);
                    return;
                }

                const parsedAuth = JSON.parse(authString);
                console.log('Found auth data:', parsedAuth);

                // Validate authentication data
                if (!parsedAuth.isAuthenticated || 
                    !parsedAuth.username || 
                    !parsedAuth.roomCode || 
                    !parsedAuth.password ||
                    parsedAuth.roomCode !== roomCode) {
                    console.log('Invalid or mismatched authentication data');
                    setConnectionStatus('Authentication mismatch');
                    setTimeout(() => {
                        router.push('/');
                    }, 2000);
                    return;
                }

                // Authentication is valid
                setAuthData(parsedAuth);
                setIsAuthenticated(true);
                setConnectionStatus('Authentication verified');
                console.log('Authentication successful for user:', parsedAuth.username);
                
            } catch (error) {
                console.error('Error checking authentication:', error);
                setConnectionStatus('Authentication error');
                setTimeout(() => {
                    router.push('/');
                }, 2000);
            } finally {
                setIsAuthChecking(false);
            }
        };

        if (roomCode) {
            checkAuthentication();
        } else {
            setIsAuthChecking(false);
            setConnectionStatus('Invalid room code');
            setTimeout(() => {
                router.push('/');
            }, 2000);
        }
    }, [roomCode, router]);

    // Socket connection - only after authentication
    useEffect(() => {
        if (!isAuthenticated || !authData || !roomCode) {
            console.log('Skipping socket connection - not authenticated');
            return;
        }

        const connectSocket = () => {
            console.log('Attempting to connect to socket server...');
            setConnectionStatus('Connecting to server...');

            const newSocket = io('http://localhost:5000', {
                transports: ['websocket', 'polling'],
                timeout: 20000,
                forceNew: true,
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
            });

            // Connection successful
            newSocket.on('connect', () => {
                console.log('Socket connected successfully:', newSocket.id);
                setIsSocketConnected(true);
                setConnectionStatus('Server connected');
                setReconnectAttempts(0);
            });

            // Connection failed
            newSocket.on('connect_error', (error) => {
                console.error('Socket connection error:', error);
                setIsSocketConnected(false);
                setIsRoomJoined(false);
                setConnectionStatus('Server connection failed');
            });

            // Disconnection
            newSocket.on('disconnect', (reason) => {
                console.log('Socket disconnected:', reason);
                setIsSocketConnected(false);
                setIsRoomJoined(false);
                setConnectionStatus('Server disconnected');
                
                if (reason === 'io server disconnect') {
                    // Server disconnected us - might be auth issue
                    console.log('Server disconnected - possible auth issue');
                }
            });

            // Handle reconnection
            newSocket.on('reconnect', (attemptNumber) => {
                console.log('Reconnected after', attemptNumber, 'attempts');
                setReconnectAttempts(0);
            });

            newSocket.on('reconnect_attempt', (attemptNumber) => {
                console.log('Reconnection attempt:', attemptNumber);
                setReconnectAttempts(attemptNumber);
                setConnectionStatus(`Reconnecting... (${attemptNumber})`);
            });

            socketRef.current = newSocket;
            setSocket(newSocket);
        };

        connectSocket();

        return () => {
            if (socketRef.current) {
                console.log('Cleaning up socket connection');
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [isAuthenticated, authData, roomCode]);

    // Room joining logic - FIXED
    const attemptJoinRoom = useCallback(() => {
        if (!socket || !roomCode || !isSocketConnected || isRoomJoined || !authData) {
            console.log('Cannot join room: missing requirements', { 
                socket: !!socket, 
                roomCode, 
                isSocketConnected, 
                isRoomJoined,
                authData: !!authData
            });
            return;
        }

        console.log('Attempting to join room:', roomCode, 'as user:', authData.username);
        setConnectionStatus('Joining room...');
        
        // Use stored authentication data instead of URL password
        socket.emit('join-room', { 
            username: authData.username, 
            roomCode: roomCode, 
            password: authData.password
        }, (response) => {
            console.log('Join room response:', response);
            
            if (response && response.success) {
                console.log('Successfully joined room');
                setIsRoomJoined(true);
                setConnectionStatus(`Connected to room ${roomCode}`);
                
                // Set initial files if provided in response
                if (response.files) {
                    console.log('Setting initial files:', response.files);
                    setFiles(response.files);
                    
                    // Set active file
                    const fileNames = Object.keys(response.files);
                    if (fileNames.length > 0) {
                        const firstFile = response.activeFile || fileNames[0];
                        setActiveFile(firstFile);
                        setCode(response.files[firstFile]?.content || '// Start coding...');
                        console.log('Set active file:', firstFile);
                    }
                }
                
                // Request additional data after successful join
                setTimeout(() => {
                    if (socket && isRoomJoined) {
                        // Get files explicitly
                        socket.emit('get-files', { roomCode }, (response) => {
                            console.log('Files received after join:', response);
                            if (response && response.files) {
                                setFiles(response.files);
                                
                                const fileNames = Object.keys(response.files);
                                if (fileNames.length > 0 && !activeFile) {
                                    const firstFile = fileNames[0];
                                    setActiveFile(firstFile);
                                    setCode(response.files[firstFile]?.content || '// Start coding...');
                                }
                            }
                        });
                        
                        // Get working directory
                        socket.emit('get-working-directory', { roomCode }, (response) => {
                            if (response && response.workingDirectory) {
                                setWorkingDirectory(response.workingDirectory);
                            }
                        });
                        
                        // Initialize terminal
                        socket.emit('terminal-init', { roomCode });
                    }
                }, 1000);
                
            } else {
                console.error('Failed to join room:', response?.error);
                setConnectionStatus(`Join failed: ${response?.error || 'Unknown error'}`);
                
                // If join failed due to authentication, redirect to dashboard
                if (response?.error?.includes('password') || response?.error?.includes('not found')) {
                    setTimeout(() => {
                        sessionStorage.removeItem('roomAuth');
                        router.push('/');
                    }, 3000);
                }
            }
        });
    }, [socket, roomCode, isSocketConnected, isRoomJoined, authData, activeFile, router]);

    // Handle room joining
    useEffect(() => {
        if (!socket || !roomCode || !isSocketConnected || isRoomJoined || !authData) {
            return;
        }

        const joinDelay = setTimeout(() => {
            attemptJoinRoom();
        }, 500);

        return () => clearTimeout(joinDelay);
    }, [socket, roomCode, isSocketConnected, isRoomJoined, authData, attemptJoinRoom]);

    // Socket event handlers - same as before but with better error handling
    useEffect(() => {
        if (!socket || !isRoomJoined) {
            return;
        }

        const handleCodeUpdate = ({ code: newCode, fileName, fromUser }) => {
            try {
                console.log('Received code update for file:', fileName, 'from user:', fromUser);
                
                if (fileName === activeFile && fromUser !== socket.id) {
                    isUpdatingFromServer.current = true;
                    setCode(newCode);
                    
                    setTimeout(() => {
                        isUpdatingFromServer.current = false;
                    }, 100);
                }
            } catch (error) {
                console.error('Error handling code update:', error);
            }
        };

        const handleFilesUpdate = (updatedFiles) => {
            try {
                console.log('Received files update:', Object.keys(updatedFiles));
                setFiles(updatedFiles);
                
                // If no active file set, set the first one
                if (!activeFile && Object.keys(updatedFiles).length > 0) {
                    const firstFile = Object.keys(updatedFiles)[0];
                    setActiveFile(firstFile);
                    setCode(updatedFiles[firstFile]?.content || '// Start coding...');
                }
                
                // If active file was deleted, switch to first available file
                if (activeFile && !updatedFiles[activeFile]) {
                    const fileNames = Object.keys(updatedFiles);
                    if (fileNames.length > 0) {
                        const newActiveFile = fileNames[0];
                        setActiveFile(newActiveFile);
                        setCode(updatedFiles[newActiveFile]?.content || '');
                    }
                }
            } catch (error) {
                console.error('Error handling files update:', error);
            }
        };

        const handleFileContentUpdate = ({ fileName, content }) => {
            try {
                console.log('File content updated:', fileName);
                if (fileName === activeFile && !isUpdatingFromServer.current) {
                    isUpdatingFromServer.current = true;
                    setCode(content);
                    setTimeout(() => {
                        isUpdatingFromServer.current = false;
                    }, 100);
                }
            } catch (error) {
                console.error('Error handling file content update:', error);
            }
        };

        const handleActiveFileChanged = ({ fileName }) => {
            try {
                console.log('Active file changed to:', fileName);
                setActiveFile(fileName);
            } catch (error) {
                console.error('Error handling active file change:', error);
            }
        };

        const handleFileCreated = ({ fileName }) => {
            console.log('File created:', fileName);
            // Refresh files list
            socket.emit('get-files', { roomCode }, (response) => {
                if (response && response.files) {
                    setFiles(response.files);
                }
            });
        };

        const handleFileDeleted = ({ fileName }) => {
            console.log('File deleted:', fileName);
        };

        const handleFileRenamed = ({ oldFileName, newFileName }) => {
            try {
                console.log('File renamed:', oldFileName, '->', newFileName);
                if (activeFile === oldFileName) {
                    setActiveFile(newFileName);
                }
            } catch (error) {
                console.error('Error handling file rename:', error);
            }
        };

        const handleFileError = ({ message }) => {
            console.error('File error:', message);
            alert(`Error: ${message}`);
        };

        const handleFileSynced = ({ fileName, content }) => {
            try {
                console.log(`File ${fileName} was synced from terminal`);
                setFiles(prevFiles => ({
                    ...prevFiles,
                    [fileName]: {
                        ...prevFiles[fileName],
                        content: content
                    }
                }));
                
                if (fileName === activeFile && !isUpdatingFromServer.current) {
                    isUpdatingFromServer.current = true;
                    setCode(content);
                    setTimeout(() => {
                        isUpdatingFromServer.current = false;
                    }, 100);
                }
            } catch (error) {
                console.error('Error handling file sync:', error);
            }
        };

        const handleUserJoined = ({ username: joinedUsername, userId }) => {
            try {
                console.log('User joined:', joinedUsername);
                setConnectedUsers(prev => {
                    if (prev.some(user => user.userId === userId)) {
                        return prev;
                    }
                    return [...prev, { username: joinedUsername, userId }];
                });
            } catch (error) {
                console.error('Error handling user joined:', error);
            }
        };

        const handleUserLeft = ({ username: leftUsername, userId }) => {
            try {
                console.log('User left:', leftUsername);
                setConnectedUsers(prev => prev.filter(user => user.userId !== userId));
            } catch (error) {
                console.error('Error handling user left:', error);
            }
        };

        // Register all event listeners
        socket.on('code-update', handleCodeUpdate);
        socket.on('files-update', handleFilesUpdate);
        socket.on('file-content-update', handleFileContentUpdate);
        socket.on('active-file-changed', handleActiveFileChanged);
        socket.on('file-created', handleFileCreated);
        socket.on('file-deleted', handleFileDeleted);
        socket.on('file-renamed', handleFileRenamed);
        socket.on('file-error', handleFileError);
        socket.on('file-synced', handleFileSynced);
        socket.on('user-joined', handleUserJoined);
        socket.on('user-left', handleUserLeft);

        return () => {
            // Clean up event listeners
            socket.off('code-update', handleCodeUpdate);
            socket.off('files-update', handleFilesUpdate);
            socket.off('file-content-update', handleFileContentUpdate);
            socket.off('active-file-changed', handleActiveFileChanged);
            socket.off('file-created', handleFileCreated);
            socket.off('file-deleted', handleFileDeleted);
            socket.off('file-renamed', handleFileRenamed);
            socket.off('file-error', handleFileError);
            socket.off('file-synced', handleFileSynced);
            socket.off('user-joined', handleUserJoined);
            socket.off('user-left', handleUserLeft);
        };
    }, [socket, isRoomJoined, activeFile, roomCode]);

    // Debounced code change handler
    const sendCodeChange = useCallback((newCode, fileName) => {
        if (codeUpdateTimeoutRef.current) {
            clearTimeout(codeUpdateTimeoutRef.current);
        }
        
        codeUpdateTimeoutRef.current = setTimeout(() => {
            if (socket && roomCode && !isUpdatingFromServer.current && isSocketConnected && isRoomJoined) {
                console.log('Sending code change for file:', fileName);
                socket.emit('code-change', { 
                    roomCode, 
                    code: newCode, 
                    fileName: fileName 
                });
            }
        }, 300);
    }, [socket, roomCode, isSocketConnected, isRoomJoined]);

    // Handle editor content changes
    const handleChange = useCallback((value) => {
        if (value !== null && value !== undefined) {
            setCode(value);
            
            if (!isUpdatingFromServer.current && activeFile && isSocketConnected && isRoomJoined) {
                sendCodeChange(value, activeFile);
            }
        }
    }, [activeFile, sendCodeChange, isSocketConnected, isRoomJoined]);

    // Manual refresh button function
    const refreshFiles = useCallback(() => {
        if (socket && roomCode && isRoomJoined && isSocketConnected) {
            console.log('Refreshing files...');
            socket.emit('get-files', { roomCode }, (response) => {
                console.log('Refreshed files received:', response);
                if (response && response.files) {
                    setFiles(response.files);
                }
            });
        }
    }, [socket, roomCode, isRoomJoined, isSocketConnected]);

    // File management functions
    const createFile = useCallback(() => {
        if (!newFileName.trim() || !socket || !roomCode || !isSocketConnected || !isRoomJoined) {
            console.log('Cannot create file: missing requirements');
            return;
        }
        
        console.log('Creating file:', newFileName.trim());
        socket.emit('create-file', { roomCode, fileName: newFileName.trim() });
        
        setNewFileName('');
        setIsCreatingFile(false);
    }, [newFileName, socket, roomCode, isSocketConnected, isRoomJoined]);

    const deleteFile = useCallback((fileName) => {
        if (Object.keys(files).length <= 1) {
            alert('Cannot delete the last file');
            return;
        }
        
        if (confirm(`Are you sure you want to delete ${fileName}?`)) {
            if (socket && roomCode && isSocketConnected && isRoomJoined) {
                console.log('Deleting file:', fileName);
                socket.emit('delete-file', { roomCode, fileName });
            }
        }
        setContextMenu({ visible: false, x: 0, y: 0, fileName: null });
    }, [files, socket, roomCode, isSocketConnected, isRoomJoined]);

    const renameFile = useCallback((oldFileName, newFileName) => {
        if (!newFileName.trim() || newFileName === oldFileName) {
            setIsRenaming(null);
            setRenameValue('');
            return;
        }
        
        if (socket && roomCode && isSocketConnected && isRoomJoined) {
            console.log('Renaming file:', oldFileName, 'to', newFileName.trim());
            socket.emit('rename-file', { roomCode, oldFileName, newFileName: newFileName.trim() });
        }
        
        setIsRenaming(null);
        setRenameValue('');
    }, [socket, roomCode, isSocketConnected, isRoomJoined]);

    const switchFile = useCallback((fileName) => {
        if (socket && roomCode && fileName !== activeFile && files[fileName] && isSocketConnected && isRoomJoined) {
            console.log('Switching to file:', fileName);
            
            setActiveFile(fileName);
            setCode(files[fileName].content || '// Loading...');
            
            socket.emit('switch-file', { roomCode, fileName });
        }
    }, [socket, roomCode, activeFile, files, isSocketConnected, isRoomJoined]);

    // Context menu handlers
    const handleRightClick = useCallback((e, fileName) => {
        e.preventDefault();
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            fileName
        });
    }, []);

    const handleClickOutside = useCallback(() => {
        setContextMenu({ visible: false, x: 0, y: 0, fileName: null });
    }, []);

    // File extension to language mapping
    const getLanguage = useCallback((fileName) => {
        if (!fileName || typeof fileName !== 'string') {
            return 'javascript';
        }
        const parts = fileName.split('.');
        const extension = parts.length > 1 ? parts.pop().toLowerCase() : '';
        const languageMap = {
            'js': 'javascript',
            'jsx': 'javascript',
            'ts': 'typescript',
            'tsx': 'typescript',
            'py': 'python',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'md': 'markdown',
            'txt': 'plaintext',
            'cpp': 'cpp',
            'c': 'c',
            'java': 'java',
            'go': 'go',
            'rs': 'rust',
            'php': 'php',
            'rb': 'ruby',
            'sh': 'shell',
            'ps1': 'powershell'
        };
        return languageMap[extension] || 'javascript';
    }, []);

    // Get file icon based on extension
    const getFileIcon = useCallback((fileName) => {
        if (!fileName || typeof fileName !== 'string') {
            return '📄';
        }
        const parts = fileName.split('.');
        const extension = parts.length > 1 ? parts.pop().toLowerCase() : '';
        const iconMap = {
            'js': '📄',
            'jsx': '⚛️',
            'ts': '📘',
            'tsx': '⚛️',
            'py': '🐍',
            'html': '🌐',
            'css': '🎨',
            'json': '📋',
            'md': '📝',
            'txt': '📄',
            'cpp': '⚙️',
            'c': '⚙️',
            'java': '☕',
            'go': '🐹',
            'rs': '🦀',
            'php': '🐘',
            'rb': '💎',
            'sh': '🖥️',
            'ps1': '💙'
        };
        return iconMap[extension] || '📄';
    }, []);

    // Connection status indicator
    const getConnectionStatusColor = () => {
        if (isSocketConnected && isRoomJoined) return 'text-green-400';
        if (isSocketConnected) return 'text-yellow-400';
        return 'text-red-400';
    };

    // Logout function
    const handleLogout = useCallback(() => {
        if (confirm('Are you sure you want to leave the room?')) {
            sessionStorage.removeItem('roomAuth');
            if (socket) {
                socket.disconnect();
            }
            router.push('/');
        }
    }, [socket, router]);

    // Show loading screen during authentication check
    if (isAuthChecking) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                    <div className="text-lg mb-2">Checking authentication...</div>
                    <div className="text-sm text-gray-400">{connectionStatus}</div>
                </div>
            </div>
        );
    }

    // Show error if not authenticated
    if (!isAuthenticated || !authData) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900 text-red-400">
                <div className="text-center">
                    <div className="text-6xl mb-4">🚫</div>
                    <div className="text-lg mb-2">Access Denied</div>
                    <div className="text-sm text-gray-400 mb-4">{connectionStatus}</div>
                    <div className="text-sm text-gray-500">Redirecting to dashboard...</div>
                </div>
            </div>
        );
    }

    if (!roomCode) {
        return (
            <div className="flex items-center justify-center h-screen text-red-500">
                <div className="text-center">
                    <div className="text-2xl mb-4">❌</div>
                    <div>No room code provided</div>
                </div>
            </div>
        );
    }

    return (
        <div className='flex h-screen bg-gray-900' onClick={handleClickOutside}>
            {/* File Explorer */}
            {showFileExplorer && (
                <div className='w-64 bg-gray-800 text-white border-r border-gray-600 flex flex-col'>
                    <div className='p-3 border-b border-gray-600 flex justify-between items-center'>
                        <h3 className='font-semibold'>Files</h3>
                        <div className='flex gap-1'>
                            <button
                                onClick={refreshFiles}
                                disabled={!isRoomJoined || !isSocketConnected}
                                className='px-2 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded text-sm'
                                title="Refresh files"
                            >
                                🔄
                            </button>
                            <button
                                onClick={() => setIsCreatingFile(true)}
                                disabled={!isRoomJoined || !isSocketConnected}
                                className='px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-sm'
                                title="Create new file"
                            >
                                +
                            </button>
                        </div>
                    </div>
                    
                    {/* User Info */}
                    <div className='px-3 py-2 text-xs border-b border-gray-600 bg-gray-750'>
                        <div className="flex justify-between items-center">
                            <span>👤 {authData?.username}</span>
                            <button
                                onClick={handleLogout}
                                className="text-red-400 hover:text-red-300 text-xs"
                                title="Leave room"
                            >
                                🚪
                            </button>
                        </div>
                    </div>
                    
                    {/* Connection Status */}
                    <div className={`px-3 py-2 text-xs border-b border-gray-600 ${getConnectionStatusColor()}`}>
                        🔗 {connectionStatus}
                        {reconnectAttempts > 0 && (
                            <span className="ml-2 text-gray-400">
                                (Attempts: {reconnectAttempts})
                            </span>
                        )}
                    </div>
                    
                    {/* Working Directory Display */}
                    {workingDirectory && (
                        <div className='px-3 py-2 text-xs text-gray-400 border-b border-gray-600'>
                            📁 {workingDirectory}
                        </div>
                    )}
                    
                    {/* Connected Users */}
                    <div className='px-3 py-2 text-xs text-gray-400 border-b border-gray-600'>
                        👥 Users: {isRoomJoined ? connectedUsers.length + 1 : 0}
                        {connectedUsers.length > 0 && (
                            <div className="mt-1">
                                {connectedUsers.map(user => (
                                    <div key={user.userId} className="text-xs">
                                        • {user.username}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    <div className='flex-1 overflow-y-auto'>
                        {/* New file input */}
                        {isCreatingFile && (
                            <div className='p-2 border-b border-gray-600'>
                                <input
                                    type="text"
                                    value={newFileName}
                                    onChange={(e) => setNewFileName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') createFile();
                                        if (e.key === 'Escape') {
                                            setIsCreatingFile(false);
                                            setNewFileName('');
                                        }
                                    }}
                                    onBlur={createFile}
                                    placeholder="Enter file name..."
                                    className='w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm'
                                    autoFocus
                                />
                            </div>
                        )}
                        
                        {/* File list */}
                        {Object.keys(files).length === 0 ? (
                            <div className='p-3 text-gray-400 text-sm'>
                                {isRoomJoined ? 'No files found. Create a new file to get started.' : 'Connecting to room...'}
                            </div>
                        ) : (
                            Object.keys(files).map((fileName) => (
                                <div
                                    key={fileName}
                                    className={`flex items-center px-3 py-2 hover:bg-gray-700 cursor-pointer ${
                                        activeFile === fileName ? 'bg-blue-600' : ''
                                    }`}
                                    onClick={() => switchFile(fileName)}
                                    onContextMenu={(e) => handleRightClick(e, fileName)}
                                >
                                    {isRenaming === fileName ? (
                                        <input
                                            type="text"
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') renameFile(fileName, renameValue);
                                                if (e.key === 'Escape') {
                                                    setIsRenaming(null);
                                                    setRenameValue('');
                                                }
                                            }}
                                            onBlur={() => renameFile(fileName, renameValue)}
                                            className='flex-1 px-1 bg-gray-700 border border-gray-600 rounded text-sm'
                                            autoFocus
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    ) : (
                                        <>
                                            <span className='mr-2'>{getFileIcon(fileName)}</span>
                                            <span className='text-sm truncate'>{fileName}</span>
                                            {activeFile === fileName && (
                                                <span className='ml-1 text-xs text-blue-300'>●</span>
                                            )}
                                        </>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Context Menu */}
            {contextMenu.visible && (
                <div
                    className='fixed bg-gray-800 border border-gray-600 rounded shadow-lg z-50 py-1'
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className='block w-full px-4 py-2 text-left text-white hover:bg-gray-700 text-sm'
                        onClick={() => {
                            setIsRenaming(contextMenu.fileName);
                            setRenameValue(contextMenu.fileName);
                            setContextMenu({ visible: false, x: 0, y: 0, fileName: null });
                        }}
                    >
                        Rename
                    </button>
                    <button
                        className='block w-full px-4 py-2 text-left text-red-400 hover:bg-gray-700 text-sm'
                        onClick={() => deleteFile(contextMenu.fileName)}
                    >
                        Delete
                    </button>
                </div>
            )}

            {/* Main Editor Area */}
            <div className='flex-1 flex flex-col'>
                {/* Header */}
                <div className='bg-gray-900 text-white p-2 border-b border-gray-600 flex items-center justify-between'>
                    <div className='flex items-center'>
                        <button
                            onClick={() => setShowFileExplorer(!showFileExplorer)}
                            className='mr-3 px-2 py-1 hover:bg-gray-700 rounded'
                            title="Toggle file explorer"
                        >
                            📁
                        </button>
                        <span className='text-sm font-medium'>
                            {activeFile ? getFileIcon(activeFile) : '📄'} {activeFile || 'No file selected'}
                        </span>
                        {activeFile && files[activeFile] && (
                            <span className='ml-2 text-xs text-gray-400'>
                                ({getLanguage(activeFile)})
                            </span>
                        )}
                    </div>
                    <div className='text-sm text-gray-400 flex items-center gap-4'>
                        <span>Room: {roomCode}</span>
                        <span className={getConnectionStatusColor()}>
                            {isSocketConnected && isRoomJoined ? '🟢' : isSocketConnected ? '🟡' : '🔴'}
                        </span>
                        <span>{isRoomJoined ? connectedUsers.length + 1 : 0} user{connectedUsers.length === 0 ? '' : 's'}</span>
                        <button
                            onClick={handleLogout}
                            className="text-red-400 hover:text-red-300 px-2 py-1 rounded"
                            title="Leave room"
                        >
                            🚪 Leave
                        </button>
                    </div>
                </div>

                {/* Editor */}
                <div className='flex-1'>
                    {activeFile && files[activeFile] && isRoomJoined ? (
                        <Editor
                            height='100%'
                            language={getLanguage(activeFile)}
                            value={code}
                            onChange={handleChange}
                            theme='vs-dark'
                            options={{
                                minimap: { enabled: false },
                                fontSize: 14,
                                lineNumbers: 'on',
                                renderWhitespace: 'selection',
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                wordWrap: 'on',
                                tabSize: 2,
                                insertSpaces: true,
                                detectIndentation: false,
                                readOnly: !isSocketConnected || !isRoomJoined
                            }}
                        />
                    ) : (
                        <div className='flex items-center justify-center h-full text-gray-400 bg-gray-900'>
                            <div className="text-center">
                                <div className="text-6xl mb-4">
                                    {!isSocketConnected ? '🔌' : !isRoomJoined ? '🚪' : '📝'}
                                </div>
                                <div className="text-lg mb-2">
                                    {!isSocketConnected 
                                        ? 'Connecting to server...' 
                                        : !isRoomJoined 
                                        ? 'Joining room...' 
                                        : 'Select a file to start editing'}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {connectionStatus}
                                </div>
                                {reconnectAttempts > 0 && (
                                    <div className="text-sm text-yellow-400 mt-2">
                                        Reconnection attempts: {reconnectAttempts}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Terminal */}
                <XTerminal socket={socket} roomCode={roomCode} isConnected={isSocketConnected && isRoomJoined} />
            </div>
        </div>
    );
}

export default CollaborativeIDE;