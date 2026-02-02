import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,   // works for ALL providers
    port: process.env.MAIL_PORT,
    secure: false, // true for 465, false for 587
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS, // App Password
    },
});
