import mongoose from "mongoose";
import {DB_URL, NODE_ENV} from '../config/env.js';

if(!DB_URL){
    throw new Error("Database URI is not defined");
}

const connectDB = async()=>{
    try{
        await mongoose.connect(DB_URL)
        console.log(`Database connected successfully in ${NODE_ENV} mode`);
    }catch(err){
        console.error(err);
        process.exit(1); 
    }
}

export default connectDB;
