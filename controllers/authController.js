import authModel from "../models/authModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const signIn = async (req, res, next) => {
    try {
        // Check if user exists
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Enter valid email and password"
            });
        }

        // Search for the user in the database
        console.log("email received:", email);
        const normalizedEmail = email.trim().toLowerCase();
        console.log("normal email:", normalizedEmail);

        const user = await authModel.findOne({ email: normalizedEmail });
        console.log("user found:", user);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Compare the password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: "Invalid password"
            });
        }

        console.log("Generating token...");
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN
        });
        
        console.log("Login successful, token generated.");
        
        res.status(200).json({
            success: true,
            message: "User signed in successfully",
            data: {
                token,
                user,
            }
        });
    } catch (err) {
        console.error("Error during sign in:", err);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: err.message
        });
    }
};

const signUp = async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        console.log("register triggered!!");

        const { userName, email, password } = req.body;
        
        if (!userName || !email || !password) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: "Enter valid userName, email and password"
            });
        }

        // Normalize email
        const normalizedEmail = email.trim().toLowerCase();

        const existingUser = await authModel.findOne({ email: normalizedEmail }).session(session);
        if (existingUser) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({ // Changed from 402 to 409 (Conflict)
                success: false,
                message: "User already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        console.log("password hashed successfully");

        console.log("creating user....");
        const newUser = await authModel.create(
            [{
                userName,
                email: normalizedEmail,
                password: hashedPassword
            }],
            { session }
        );

        const user = newUser[0];
        console.log("new user created successfully:", user);

        console.log("Generating token...");
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN
        });

        console.log("JWT token generated successfully:", token);

        await session.commitTransaction();
        session.endSession();

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            data: {
                token,
                user: {
                    id: user._id,
                    userName: user.userName,
                    email: user.email
                }, // Don't send back the hashed password
            },
        });
    } catch (err) {
        console.error("Error during signup:", err);
        
        // Rollback transaction on error
        await session.abortTransaction();
        session.endSession();

        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: err.message
        });
    }
};

export { signIn, signUp };