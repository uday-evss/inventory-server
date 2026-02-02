import axios from "axios";

const WHAPI_BASE_URL = "https://gate.whapi.cloud";

export const sendWhatsappMessage = async ({ to, message }) => {
    try {
        const response = await axios.post(
            `${WHAPI_BASE_URL}/messages/text`,
            {
                to: `91${to}`,
                body: message,
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHAPI_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        console.log("WHAPI RESPONSE:", response.data);
    } catch (error) {
        console.error(
            "WhatsApp send failed:",
            error?.response?.data || error.message
        );
    }
};
