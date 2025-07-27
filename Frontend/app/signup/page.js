'use client';
import { useState, useRef, useEffect } from "react";
import * as THREE from 'three';
import { Github } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

function ThreeBackground(){
    const mountRef = useRef(null);
    const sceneRef = useRef(null);
    const rendererRef = useRef(null);
    const animationRef = useRef(null);

    useEffect(()=>{
        if(typeof window === 'undefined') return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({
            alpha:true,
            antialias: true
        })

        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x000000, 0);

        sceneRef.current = scene;
        rendererRef.current = renderer;

        const geometries=[
            new THREE.BoxGeometry(1.2,1.2,1.2),
            new THREE.SphereGeometry(0.8, 32, 32),
            new THREE.ConeGeometry(0.7, 1.5, 8)
        ]

        const materials = [
            new THREE.MeshBasicMaterial({ color: 0x4f46e5, roughness: 0.3, metalness:0.6  }),
            new THREE.MeshBasicMaterial({ color: 0x06b6d4, roughness: 0.3, metalness:0.6  }),
            new THREE.MeshBasicMaterial({ color: 0x8b5cf6, roughness: 0.3, metalness:0.6  }),
            new THREE.MeshBasicMaterial({ color: 0xf59e0b, roughness: 0.3, metalness:0.6  }),
            new THREE.MeshBasicMaterial({ color: 0xef4444, roughness: 0.3, metalness:0.6  })  
        ];

        const objects = [];
        for(let i=0; i<20; i++){
            const geometry = geometries[Math.floor(Math.random() * geometries.length)];
            const material = materials[Math.floor(Math.random() * materials.length)];
            const mesh = new THREE.Mesh(geometry, material);

            mesh.position.x = (Math.random()-0.5) * 40;
            mesh.position.y = (Math.random()-0.5) * 40;
            mesh.position.z = (Math.random()-0.5) * 40;
            mesh.rotation.x = Math.random() * Math.PI;
            mesh.rotation.y = Math.random() * Math.PI;
            
            mesh.userData = {
                initialX: mesh.position.x,
                initialY: mesh.position.y,
                initialZ: mesh.position.z,
                rotationSpeed:{
                    x: (Math.random() - 0.005),
                    y: (Math.random() - 0.005),
                    z: (Math.random() - 0.005)
                },
                floatSpeed: (Math.random() * 0.01 + 0.01)
            }
            scene.add(mesh);
            objects.push(mesh)
        }   

        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 5);
        scene.add(directionalLight);

        camera.position.z = 5;

        const animate = () => {
            animationRef.current = requestAnimationFrame(animate);

            objects.forEach((obj, index)=>{
                const speed = obj.userData.floatSpeed;
                const time = Date.now() * 0.001;

                obj.position.x = obj.userData.initialX + Math.cos(time * speed + index) * 3;
                obj.position.y = obj.userData.initialY + Math.sin(time * speed + index * 0.5) * 2;
                obj.position.z = obj.userData.initialZ + Math.sin(time * speed + index * 0.8) * 2.5;
                
                obj.position.y = obj.userData.initialY + Math.sin(time + index) * 2;
                obj.position.x = obj.userData.initialX + Math.cos(time + index) * 2;
                obj.position.z = obj.userData.initialZ + Math.cos(time + index * 0.5) * 1.5
            });

            renderer.render(scene, camera);
        };
        
        const handleResize = () => {
            if(camera && renderer){
                camera.aspect = window.innerWidth/window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            }
        };

        window.addEventListener('resize', handleResize);

        if(mountRef.current){
            mountRef.current.appendChild(renderer.domElement)
        }

        animate();

        return()=>{
            window.removeEventListener('resize', handleResize);
            if(animationRef.current){
                cancelAnimationFrame(animationRef.current);
            }
            if(mountRef.current && renderer.domElement){
                mountRef.current.removeChild(renderer.domElement);
            }

            objects.forEach(obj =>{
                scene.remove(obj);
                obj.geometry?.dispose();
                obj.material?.dispose();
            });
            renderer.dispose();
        }
    },[])
    
    return <div ref={mountRef} className='fixed inset-0 -z-10'/>;
}

function SignupPage() {
    const router = useRouter();
    const [form, setForm] = useState({
        userName: '',
        email: '',
        password: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e) => {
        setForm({
            ...form,
            [e.target.name]: e.target.value
        });
        if(error) setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        // Basic form validation
        if (!form.userName || !form.email || !form.password) {
            setError('Please fill in all fields');
            setLoading(false);
            return;
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(form.email)) {
            setError('Please enter a valid email address');
            setLoading(false);
            return;
        }

        // Password strength validation
        if (form.password.length < 6) {
            setError('Password must be at least 6 characters long');
            setLoading(false);
            return;
        }

        try {
            const response = await fetch('http://localhost:5000/api/auth/sign-up', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(form),
            });
            router.push('/dashboard');

            const data = await response.json();

            if (!response.ok) {
            // Handle different types of error responses
            const errorMessage = data.message || data.error || 'Signup failed';
            throw new Error(errorMessage);
            }

            if (!data.success) {
            throw new Error(data.message || 'Signup failed');
            }

            // Store token if provided
            if(data.data?.token){
                // In a real application you'd use localStorage, but for this demo we'll use state
                console.log('Token received:', data.data.token);
            }

            // Clear form after successful signup
            setForm({
                userName: '',
                email: '',
                password: ''
            });
            
            alert('Signup successful! Welcome aboard!');
            console.log('Registration successful:', data);

        } catch (error) {
            console.error('Signup failed:', error);
            setError(error.message || 'Signup failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen relative overflow-hidden">
            {/* 3D Background */}
            <ThreeBackground />
            
            {/* Overlay gradient for better readability */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-blue-900/20 to-indigo-900/20 backdrop-blur-sm"></div>
            
            {/* Main Content */}
            <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    {/* Glassmorphism Card */}
                    <div className="backdrop-blur-lg bg-white/10 rounded-2xl border border-white/20 shadow-2xl p-8">
                        {/* Header */}
                        <div className="text-center mb-8">
                            <h2 className="text-3xl font-bold text-white mb-2">Join Us Today</h2>
                            <p className="text-white/70">Create your account to get started</p>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="mb-6 p-3 bg-red-500/20 border border-red-400/30 rounded-lg text-red-200 text-sm">
                                {error}
                            </div>
                        )}

                        {/* Form */}
                        <div className="space-y-6">
                            {/* Full Name Input */}
                            <div className="space-y-2">
                                <label htmlFor="userName" className="block text-sm font-medium text-white/90">
                                    Full Name
                                </label>
                                <div className="relative">
                                    <input 
                                        id="userName"
                                        name="userName" 
                                        type="text" 
                                        placeholder="Enter your full name"
                                        value={form.userName}
                                        onChange={handleChange}
                                        required
                                        disabled={loading}
                                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent backdrop-blur-sm transition-all duration-300 disabled:opacity-50"
                                    />
                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <svg className="h-5 w-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                    </div>
                                </div>
                            </div>

                            {/* Email Input */}
                            <div className="space-y-2">
                                <label htmlFor="email" className="block text-sm font-medium text-white/90">
                                    Email Address
                                </label>
                                <div className="relative">
                                    <input 
                                        id="email"
                                        name="email" 
                                        type="email" 
                                        placeholder="Enter your email"
                                        value={form.email}
                                        onChange={handleChange}
                                        required
                                        disabled={loading}
                                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent backdrop-blur-sm transition-all duration-300 disabled:opacity-50"
                                    />
                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <svg className="h-5 w-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                                        </svg>
                                    </div>
                                </div>
                            </div>

                            {/* Password Input */}
                            <div className="space-y-2">
                                <label htmlFor="password" className="block text-sm font-medium text-white/90">
                                    Password
                                </label>
                                <div className="relative">
                                    <input 
                                        id="password"
                                        name="password" 
                                        type="password" 
                                        placeholder="Create a strong password"
                                        value={form.password}
                                        onChange={handleChange}
                                        required
                                        disabled={loading}
                                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent backdrop-blur-sm transition-all duration-300 disabled:opacity-50"
                                    />
                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <svg className="h-5 w-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                        </svg>
                                    </div>
                                </div>
                            </div>

                            {/* Submit Button */}
                            <button 
                                type="submit"
                                onClick={handleSubmit}
                                disabled={loading}
                                className="w-full py-3 px-4 bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-lg transform transition-all duration-300 hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2 focus:ring-offset-transparent"
                            >
                                <span className="flex items-center justify-center">
                                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                    </svg>
                                    {loading ? 'Creating Account...' : 'Create Account'}
                                </span>
                            </button>
                        </div>

                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-white/20"></div>
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-4 bg-white/10 text-white/70 rounded-full backdrop-blur-sm">
                                    OR
                                </span>
                            </div>
                        </div>

                        {/* GitHub Login */}
                        <div>
                            <a href="https://github.com/login/oauth/authorize?client_id=Ov23lie11ZKh27OLsYzH&scope=user&state=randomstring">
                                <button type="button" className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-lg transition">
                                    <Github size={20} />
                                    Login with GitHub
                                </button>
                            </a>
                        </div>

                        {/* Footer Links */}
                        <div className="mt-6 text-center space-y-2">
                            <div className="text-white/50 text-sm">
                                Already have an account? 
                                <Link href="/login" className="text-white/70 hover:text-white ml-1 transition-colors duration-300">
                                    Sign In
                                </Link>
                            </div>
                            <div className="text-xs text-white/40 mt-4">
                                By creating an account, you agree to our Terms of Service and Privacy Policy
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SignupPage;