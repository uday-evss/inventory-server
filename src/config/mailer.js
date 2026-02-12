// import nodemailer from "nodemailer";

// export const transporter = nodemailer.createTransport({
//     host: process.env.MAIL_HOST,   // works for ALL providers
//     port: process.env.MAIL_PORT,
//     secure: false, // true for 465, false for 587
//     auth: {
//         user: process.env.MAIL_USER,
//         pass: process.env.MAIL_PASS, // App Password
//     },
// });

import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export const sendEmail = async ({ to, subject, html }) => {
    const msg = {
        to,
        from: process.env.FROM_EMAIL, // Make sure this is verified in SendGrid
        subject,
        html,
    };

    try {
        await sgMail.send(msg);
        console.log("Email sent successfully");
    } catch (error) {
        console.error("SendGrid Error:", error.response?.body || error.message);
        throw new Error("Email sending failed");
    }
};


