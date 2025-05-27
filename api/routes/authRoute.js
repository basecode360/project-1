import express from 'express';
import Joi from 'joi';
import User from '../models/Users.js';
import sendResponse from '../helper/sendResponse.js'; // Assuming you have a utility function for sending responses
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const route = express.Router();


route.get('/', (req, res) => {

    res.status(500).json({
        success: false,
        message: 'Logged in'
    });
}
)


const loginSchema = Joi.object({
    email: Joi.string().email({
        minDomainSegments: 2,
        tlds: ['com', 'net', 'org']
    }).required(),
    password: Joi.string().min(6).required()
})

route.post('/register', async (req,res) => {
    const {error, value} = loginSchema.validate(req.body);
    if (error) {
        sendResponse(res, 400, false, error.details[0].message);
    }
    const user = await User.findOne({ email: value.email });
    if (user) {
        return sendResponse(res, 400, false, 'User already exists');
    }
    const hashedPassword = await bcrypt.hash(value.password, 10);
    value.password = hashedPassword;
    let newUser = new User({
        email: value.email,
        password: value.password
    });
    newUser = await newUser.save();
    sendResponse(res, 201, true, 'User registered successfully', {
        user: {
            id: newUser._id,
            email: newUser.email
        } 
    });
})



route.post('/login', async (req, res) => {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
        return sendResponse(res, 400, false, error.details[0].message);
    }
    if (!value.email || !value.password) {
        return sendResponse(res, 400, false, 'Email and password are required');
    }
    console.log(value);
    const user = await User.findOne({ email: value.email });
    if (!user) {
        return sendResponse(res, 400, false, 'Invalid email or password');
    }
    const isPasswordValid = await bcrypt.compare(value.password, user.password);
    if (!isPasswordValid) {
        return sendResponse(res, 400, false, 'Invalid email or password');
    }
    delete user.password; // Remove password from user object before sending
    const token = jwt.sign({...user}, process.env.JWT_SECRET)
    sendResponse(res, 200, true, 'Login successful', {
        user: {
            id: user._id,
            email: user.email
        },
        token
    });
})
export default route;