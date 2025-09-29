import axios from 'axios'
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";


const sesClient = new SESClient();


module.exports.alert = async(event) => {
    console.log('SNS Event Recieved ', event);

    const snsMessage = event.Records[0].Sns.Message
    const webhookURL = process.env.WEBHOOK_URL

    const slackMessage = {
        text: `🚨 AWS Cost Anomaly Detected! 🚨\n> ${snsMessage}`
    }

    // Send the message to Slack
    try {
        await axios.post(webhookURL, slackMessage);
        console.log('Successfully sent webhook notification.')
    } catch (error) {
        console.log('Error sending webhook notification:', error.message)
    }

    // Send the message to user email using SES
    const emailParams = {
        Source: '<sender_email_address>',
        Destination: {
            ToAddresses: ['<reciever_email_address>'],
        },
        Message: {
            Subject: { Data: 'AWS Cost Anomaly Detected!' },
            Body: {
                Text: { Data: `An AWS Cost Anomaly was detected with the following details:\n\n${snsMessage}` },
            },
        }
    }

    try {
        await sesClient.send(new SendEmailCommand(emailParams));
        console.log('Successfully sent email notification.');
    } catch (error) {
        console.log('Error Occurred', error.message);
    }

    return { statusCode: 200, body: 'Notification processed.' }
}
