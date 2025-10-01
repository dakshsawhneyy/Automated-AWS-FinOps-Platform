import axios from 'axios'
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { EC2Client, DescribeVolumesCommand } from "@aws-sdk/client-ec2";
import { ComputeOptimizerClient, GetEC2InstanceRecommendationsCommand } from "@aws-sdk/client-compute-optimizer";     
const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts"); // Import the STS client

const sesClient = new SESClient();
const ec2Client = new EC2Client({region: 'ap-south-1'});
const computeClient = new ComputeOptimizerClient({region: 'ap-south-1'})
const stsClient = new STSClient()

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
                    const alreadyTagged = volume.Tags && volume.Tags.find((tag) => tag.Key === 'Status' && tag.Value === 'Ready-For-Deletion')

                    if(!alreadyTagged){
                        STALE_EBS_VOLUMES.push({ID: volume.VolumeId, Type: volume.VolumeType, Size: volume.Size, Region: volume.AvailabilityZone})
                    }
                }

            })
        }

        // If there are unused volumes, tag them to delete afterwards and also 7 days time to delete them automatically
        if(STALE_EBS_VOLUMES.length > 0){
            console.log(`Found ${STALE_EBS_VOLUMES.length} unused EBS Volumes`)

            // Fetch the list of volume IDs to tag
            const volumeIdsToTag = STALE_EBS_VOLUMES.map((vol) => vol.ID);

            // Calculate the deletion date for 7 days in the future
            const deleteDate = new Date();
            deleteDate.setDate(deleteDate.getDate() + 7);
            const deleteDateString = deleteDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD

            // Create the command to tag EBS Volumes
            const tagCommand = new CreateTagsCommand({
                Resources: volumeIdsToTag,
                Tags: [
                    { Key: "Status", Value: "Ready-For-Deletion" },
                    { Key: "DeletionDate", Value: deleteDateString }
                ]
            })

            // Send the tags to ec2 client, to apply on EBS Volumes
            await ec2Client.send(tagCommand)
            console.log(`Successfully tagged ${volumeIdsToTag.length} volume(s) for deletion on ${deleteDateString}.`);
        }

        const STALE_EBS_VOLUME_LENGTH = STALE_EBS_VOLUMES.length

        // If there are more than one unused snapshots, send notification to user on slack
        const slackMessage = {
            text: `🚨 🧹 EBS Janitor found and tagged ${volumesToTag.length} new unused EBS volume(s) for deletion in 7 days:\n\`\`\`${JSON.stringify(STALE_EBS_VOLUMES, null, 2)} 🚨\`\`\``
        }

        if(STALE_EBS_VOLUMES.length > 0){
            await axios.post(webhookURL, slackMessage);
            console.log('Successfully sent webhook notification.')
        }

        return { statusCode: 200, body: 'Janitor Listed all EBS Volumes and tagged them for deletion in 7 days' }
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
