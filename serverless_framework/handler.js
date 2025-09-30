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

module.exports.janitor = async(event) => {
    try {
        const command = new DescribeVolumesCommand();
        const response = await ec2Client.send(command);
        
        let STALE_EBS_VOLUME_COUNT = 0
        const STALE_EBS_VOLUMES = []

        // Listing All EBS Volumes
        if(response.Volumes && response.Volumes.length > 0){
            console.log("EBS VOLUMES:")

            response.Volumes.forEach((volume) => {
                console.log(`Volume ID: ${volume.VolumeId}, State: ${volume.State}`);

                if(volume.State === 'available'){
                    STALE_EBS_VOLUME_COUNT += 1;
                    STALE_EBS_VOLUMES.push({ID: volume.VolumeId, Type: volume.VolumeType, Size: volume.Size, Region: volume.AvailabilityZone})
                }
            })
        }else{
            console.log("No EBS volumes found.");
        }

        // If there are more than one unused snapshots, send notification to user on slack
        const slackMessage = {
            text: `🚨 🧹 EBS Janitor found ${STALE_EBS_VOLUME_COUNT} unused EBS volume(s) to be cleaned up:\n\`\`\`${JSON.stringify(STALE_EBS_VOLUMES, null, 2)} 🚨\`\`\``
        }

        await axios.post(webhookURL, slackMessage);
        console.log('Successfully sent webhook notification.')

        return { statusCode: 200, body: 'Janitor Listed all EBS Volumes' }
    } catch (error) {
        console.log('Error Occurred', error.message)
        return { statusCode: 500, body: 'Error in EBS Janitor' }
    }
} 
