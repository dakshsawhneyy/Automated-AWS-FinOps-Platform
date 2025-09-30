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

module.exports.optimizer = async(event) => {
    try {
        // // Get the current AWS Account ID
        const identity = await stsClient.send(new GetCallerIdentityCommand());
        const accountId = identity.Account;

        // // Ask Compute Optimizer for recommendations for our account
        const command = new GetEC2InstanceRecommendationsCommand({ accountIds: [accountId] })
        const response = await computeClient.send(command);

        const recommendations = []

        if(response.instanceRecommendations && response.instanceRecommendations.length > 0){
            response.instanceRecommendations.forEach((record) => {
                // 'Overprovisioned' means the instance is too big for its workload
                if(record.finding === 'OVER_PROVISIONED'){
                    recommendations.push({
                        Instance: record.instanceArn,
                        currentType: record.currentInstanceType,
                        recommendedType: record.recommendationOptions[0].instanceType,
                        estimatedSavings: `$${record.recommendationOptions[0].estimatedMonthlySavings.value}`
                    })
                }
            })
        }

        // Send this as a slack message
        let slackMessage
        if(recommendations.length > 0){
            slackMessage = {
                text: `AWS Optimizer found ${recommendations.length} EC2 instance(s) to right-size:\n\`\`\`${JSON.stringify(recommendations, null, 2)}\`\`\``
            }
        }else{
            slackMessage = {
                text: `AWS Optimizer check complete. No overprovisioned EC2 instances found.`
            }
        }

        await axios.post(webhookURL, slackMessage);
        console.log('Successfully sent optimizer report to Slack.')

        // Sending optimizer report to email
        const emailParams = {
            Source: 'dakshsawhneyy@gmail.com',
            Destination: {
                ToAddresses: ['dakshsawhney2@gmail.com'],
            },
            Message: {
                Subject: { Data: `AWS Optimizer found ${recommendations.length} EC2 instance(s) to right-size` },
                Body: {
                    Text: { Data: `${JSON.stringify(recommendations, null, 2)}` },
                },
            }
        }
        await sesClient.send(new SendEmailCommand(emailParams));
        console.log('Successfully sent email notification.');

        return { statusCode: 200, body: 'Optimizer check complete.' }
    } catch (error) {
        console.log('Error Occurred: ', error.message)
        return { statusCode: 500, body: 'Optimizer check complete.' }
    }
}
