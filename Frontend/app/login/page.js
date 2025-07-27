'use client'
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from 'axios';
import * as THREE from 'three';
import {Github} from 'lucide-react';
import Link from "next/link";

function ThreeBackground(){
    const mountRef = useRef(null);
    const sceneRef = useRef(null);
    const animationRef = useRef(null);
    const rendererRef = useRef(null);

    useEffect(()=>{
        if(typeof window === 'undefined') return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true
        });

        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x000000, 0);

        sceneRef.current = scene;
        rendererRef.current = renderer;

        // Create a geometry and material for the background
        const geometries = [
            new THREE.BoxGeometry(1.2, 1.2, 1.2),
            new THREE.SphereGeometry(0.8, 32, 32),
            new THREE.ConeGeometry(0.7, 1.5, 8),
        ];

        const materials = [
            new THREE.MeshBasicMaterial({ color: 0x4f46e5, roughness: 0.3, metalness:0.6  }),
            new THREE.MeshBasicMaterial({ color: 0x06b6d4, roughness: 0.3, metalness:0.6  }),
            new THREE.MeshBasicMaterial({ color: 0x8b5cf6, roughness: 0.3, metalness:0.6  }),
            new THREE.MeshBasicMaterial({ color: 0xf59e0b, roughness: 0.3, metalness:0.6  }),
            new THREE.MeshBasicMaterial({ color: 0xef4444, roughness: 0.3, metalness:0.6  })          
        ];

        //create multiple floating objects
        const objects = [];
            for(let i=0; i<20; i++){
                const geometry = geometries[Math.floor(Math.random() * geometries.length)];
                const material = materials[Math.floor(Math.random() * materials.length)];
                const mesh = new THREE.Mesh(geometry, material);
            

            //Randomize position and rotation
            mesh.position.x = (Math.random() - 0.5) * 40;
            mesh.position.y = (Math.random() - 0.5) * 40;
            mesh.position.z = (Math.random() - 0.5) * 40;
            mesh.rotation.x = Math.random() * Math.PI;
            mesh.rotation.y = Math.random() * Math.PI;

            //store initial position and rotation for animation
            mesh.userData = {
                initialX: mesh.position.x,
                initialY: mesh.position.y,
                initialZ: mesh.position.z,
                rotationSpeed: {
                    x: (Math.random()-0.005),
                    y: (Math.random()-0.005),
                    z: (Math.random()-0.005)
                },
                floatSpeed: (Math.random() * 0.01 + 0.01)
            };
            scene.add(mesh);
            objects.push(mesh);
        }

        // Add lights to the scene
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        scene.add(ambientLight);

        //add directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 5);
        scene.add(directionalLight);

        //position the camera
        camera.position.z = 5;

        //animation loop
        const animate = () => {
            animationRef.current = requestAnimationFrame(animate);

            objects.forEach((obj, index)=>{
                
                //animate objects
                const speed = obj.userData.floatSpeed;
                const time = Date.now() * 0.001
                // Move along a smooth path
                obj.position.x = obj.userData.initialX + Math.cos(time * speed + index) * 3;
                obj.position.y = obj.userData.initialY + Math.sin(time * speed + index * 0.5) * 2;
                obj.position.z = obj.userData.initialZ + Math.sin(time * speed + index * 0.8) * 2.5;
                //float effect
                
                obj.position.y = obj.userData.initialY + Math.sin(time + index) * 2;
                obj.position.x = obj.userData.initialX + Math.cos(time + index) * 2;
                obj.position.z = obj.userData.initialZ + Math.cos(time + index * 0.5) * 1.5
            });

            //render the scene
            renderer.render(scene, camera)
        };

        //handle window sizing
        const handleResize = () => {
            if(camera && renderer){
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight)
            }
        };

        window.addEventListener('resize', handleResize);

        //Mount to DOM
        if(mountRef.current){
            mountRef.current.appendChild(renderer.domElement)
        }

        //start animation
        animate();

        //clean up function
        return() => {
            window.removeEventListener('resize', handleResize);
            if(animationRef.current){
                cancelAnimationFrame(animationRef.current);
            }
            if(mountRef.current && renderer.domElement){
                mountRef.current.removeChild(renderer.domElement);
            }

            //dispose three.js objects
            objects.forEach(obj => {
                scene.remove(obj);
                obj.geometry?.dispose();
                obj.geometry?.dispose();
            });
            renderer.dispose();
        }

    }, []);
    return <div ref={mountRef} className="fixed inset-0 -z-10"/>;
} 

function LoginPage(){
    const router = useRouter();
    const [form, setForm] = useState({
        email:'',
        password:''
    });

    const handleChange = (e) => {
        setForm({
            ...form,
            [e.target.name]: e.target.value
        })
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        try{
            const res = await axios.post('http://localhost:5000/api/auth/sign-in', form);
            localStorage.setItem('token', res.data.token);
            alert('Login successful');
            router.push('/dashboard')
            localStorage.setItem('token', res.data.token);

        }catch(error){
            console.error('Login failed:',error);
            alert('Login Failed');
        }
    }

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
                            <h2 className="text-3xl font-bold text-white mb-2">Welcome Back</h2>
                            <p className="text-white/70">Sign in to your account</p>
                        </div>

                        {/* Form */}
                        <div className="space-y-6">
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
                                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent backdrop-blur-sm transition-all duration-300"
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
                                        placeholder="Enter your password"
                                        value={form.password}
                                        onChange={handleChange}
                                        required
                                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent backdrop-blur-sm transition-all duration-300"
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
                                className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium rounded-lg shadow-lg transform transition-all duration-300 hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-transparent"
                            >
                                <span className="flex items-center justify-center">
                                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                                    </svg>
                                    Sign In
                                </span>
                            </button>
                        </div>

                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-white/20"></div>
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-4 bg-white/10 text-white/70 rounded-full backdrop-blur-sm z-50">
                                        OR
                                </span>
                            </div>
                        </div>
                        
                         {/*GitHub*/}
                            <div className="my-5">
                                <a href="https://github.com/login/oauth/authorize?client_id=Ov23lie11ZKh27OLsYzH&scope=user&state=randomstring">
                                    <button type="button" className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-xl border border-gray-700 shadow-lg transform transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-transparent">
                                            <Github size={20} />
                                            Login with GitHub
                                    </button>
                                </a>
                            </div>

                        {/* Footer Links */}
                        <div className="mt-6 text-center space-y-2">
                            <a href="#" className="text-white/70 hover:text-white text-sm transition-colors duration-300">
                                Forgot your password?
                            </a>
                            <div className="text-white/50 text-sm">
                                Don't have an account? 
                                <Link href="/signup" className="text-white/70 hover:text-white ml-1 transition-colors duration-300">
                                    Sign up
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default LoginPage;