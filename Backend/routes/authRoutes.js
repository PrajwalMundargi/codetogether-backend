import { Router} from 'express';
import {signIn, signUp} from '../controllers/authController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const authRoutes = Router();

authRoutes.post('/sign-in',signIn);
authRoutes.post('/sign-up',signUp);

export default authRoutes;