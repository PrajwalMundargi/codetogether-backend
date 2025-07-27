import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
    roomCode: { 
        type: String, 
        required: true, 
        unique: true, 
        uppercase: true 
    },
    password: { 
        type: String, 
        required: true 
    },
    createdAt: { 
        type: Date, 
        default: Date.now,
        expires: 86400 // Expires after 24 hours (optional)
    }
});

const roomModel = mongoose.model('room', roomSchema);
export default roomModel;