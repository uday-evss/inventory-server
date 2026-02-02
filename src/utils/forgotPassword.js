export const forgotPasswordMail = (name, password) => ({
    subject: "Your new login password – KDM Engineers",
    text: `Hello ${name},

Your password has been reset.

Temporary Password: ${password}

For security reasons, you must change your password after logging in.

– KDM Engineers IT Team`,
});


