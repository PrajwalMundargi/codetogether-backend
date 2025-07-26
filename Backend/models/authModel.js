import mongoose from "mongoose";

const authSchema  = new mongoose.Schema({
    userName:{
        type: String,
        required: true,
        uniqure: true,
    },
    email:{
        type:String,
        required:true,
    },
    password:{
        type:String,
        required:true
    },
},{collection: "user"})

const authModel = mongoose.model("auth", authSchema);
export default authModel;