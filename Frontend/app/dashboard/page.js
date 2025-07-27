'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Plus, LogIn, Code2, Shield } from 'lucide-react';
import socket from '../../socket';

function JoinOrCreateRoom() {
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState('create');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  /* ------------------------------------------------------------------ */
  const ensure = (cond, msg) => { 
    if (!cond) { 
      alert(msg); 
      throw new Error(msg); 
    } 
  };

  /* ---------- create ---------- */
  const createRoom = () => {
    ensure(username.trim(), 'Please enter your username first!');
    ensure(password.trim(), 'Please enter a password!');

    setIsLoading(true);

    socket.emit('create-room', { username, password }, (res) => {
      setIsLoading(false);
      
      if (res?.success && res?.roomCode) {
        // Store user info in sessionStorage for room access
        sessionStorage.setItem('roomAuth', JSON.stringify({
          roomCode: res.roomCode,
          username: username,
          password: password,
          isAuthenticated: true
        }));
        
        alert(`Room created successfully! Room Code: ${res.roomCode}`);
        router.push(`/room/${res.roomCode}`);
      } else {
        alert(res?.error || 'Failed to create room. Please try again.');
      }
    });
  };

  /* ---------- join ------------ */
  const joinRoom = () => {
    ensure(username.trim(), 'Please enter your username first!');
    ensure(roomCode.trim(), 'Please enter a room code!');
    ensure(password.trim(), 'Please enter a password!');

    setIsLoading(true);

    socket.emit('join-room', { roomCode: roomCode.toUpperCase(), username, password }, (res) => {
      setIsLoading(false);
      
      if (res?.success) {
        // Store user info in sessionStorage for room access
        sessionStorage.setItem('roomAuth', JSON.stringify({
          roomCode: roomCode.toUpperCase(),
          username: username,
          password: password,
          isAuthenticated: true
        }));
        
        alert(`Successfully joined room ${roomCode.toUpperCase()}!`);
        router.push(`/room/${roomCode.toUpperCase()}`);
      } else {
        alert(res?.error || 'Failed to join room. Please check room code and password.');
      }
    });
  };

  /* ------------------------------------------------------------------ */
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />

      {/* animated blobs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40  -right-40  w-80 h-80 bg-purple-500/20  rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/20    rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute  top-1/2   left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl animate-pulse delay-500" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* header */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm border border-white/20">
              <Code2 className="w-12 h-12 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            Code Room
          </h1>
          <p className="text-white/70 text-lg">Collaborate with developers in real-time</p>
        </div>

        {/* card */}
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 shadow-2xl">
          {/* username */}
          <div className="mb-6">
            <label className="block text-white/90 text-sm font-medium mb-3">Your Username</label>
            <div className="relative">
              <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 w-5 h-5" />
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Your Name"
                disabled={isLoading}
                className="w-full pl-12 pr-4 py-4 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all duration-300 disabled:opacity-50"
              />
            </div>
          </div>

          {/* tab nav */}
          <div className="flex bg-white/5 rounded-2xl p-1 mb-6">
            {['create','join'].map(tab => (
              <button
                key={tab}
                onClick={() => !isLoading && setActiveTab(tab)}
                disabled={isLoading}
                className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all duration-300 disabled:opacity-50 ${
                  activeTab === tab
                    ? tab === 'create'
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                      : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                {tab === 'create'
                  ? <Plus className="w-4 h-4 inline mr-2" />
                  : <LogIn className="w-4 h-4 inline mr-2" />}
                {tab === 'create' ? 'Create Room' : 'Join Room'}
              </button>
            ))}
          </div>

          {/* room code input for join tab */}
          {activeTab === 'join' && (
            <div className="mb-6">
              <label className="block text-white/90 text-sm font-medium mb-3">Room Code</label>
              <input
                value={roomCode}
                onChange={e => setRoomCode(e.target.value.toUpperCase())}
                placeholder="Enter Room Code"
                disabled={isLoading}
                className="w-full px-4 py-4 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-white/50 text-center text-lg font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all duration-300 disabled:opacity-50"
                maxLength={6}
              />
            </div>
          )}

          {/* password */}
          <div className="mb-6">
            <label className="block text-white/90 text-sm font-medium mb-3">
              {activeTab === 'create' ? 'Set Room Password' : 'Room Password'}
            </label>
            <div className="relative">
              <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 w-5 h-5" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={activeTab === 'create' ? 'Create Password' : 'Enter Password'}
                disabled={isLoading}
                className="w-full pl-12 pr-4 py-4 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all duration-300 disabled:opacity-50"
              />
            </div>
          </div>

          {/* actions */}
          {activeTab === 'create' ? (
            <button
              onClick={createRoom}
              disabled={isLoading}
              className="w-full py-4 mb-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold rounded-2xl transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:transform-none disabled:hover:scale-100"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Creating Room...
                </div>
              ) : (
                <>
                  <Plus className="w-5 h-5 inline mr-2" />Create New Room
                </>
              )}
            </button>
          ) : (
            <button
              onClick={joinRoom}
              disabled={isLoading}
              className="w-full py-4 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-semibold rounded-2xl transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:transform-none disabled:hover:scale-100"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Joining Room...
                </div>
              ) : (
                <>
                  <LogIn className="w-5 h-5 inline mr-2" />Join Room
                </>
              )}
            </button>
          )}
        </div>

        <p className="text-white/50 text-sm text-center mt-6">
          {username ? `Welcome, ${username}!` : 'Ready to code? Enter your name to get started.'}
        </p>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from { opacity:0; transform:translateY(20px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .animate-fade-in { animation: fade-in .5s ease-out; }
      `}</style>
    </div>
  );
}

export default JoinOrCreateRoom;