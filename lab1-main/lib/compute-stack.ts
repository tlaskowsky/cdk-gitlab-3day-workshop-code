// lib/compute-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface ComputeStackProps extends cdk.StackProps {
  processingQueue: sqs.Queue;
}

export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    // --- Look up VPC ---
    const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
      tags: { Name: 'WorkshopVPC' }, isDefault: false,
    });

    // --- IAM Role ---
    const ec2Role = new iam.Role(this, 'EC2InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
     });
    props.processingQueue.grantConsumeMessages(ec2Role);

    // --- Security Group ---
    const ec2SecurityGroup = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
      vpc: vpc,
      description: 'Security group for the document processing EC2 instance',
      allowAllOutbound: true,
    });

    // --- EC2 UserData (Writing script directly via heredoc) ---
    const userData = ec2.UserData.forLinux();

    // Define the script content using a template literal.
    // Ensure the echo command has its argument double-quoted.
        
    const pollingScript = `#!/bin/bash
    echo "Polling SQS Queue: ${props.processingQueue.queueUrl} (Region determined automatically by AWS CLI)"
    while true; do
      # --- MODIFIED LINE BELOW: Use 'aws' directly, rely on PATH ---
      aws sqs receive-message --queue-url ${props.processingQueue.queueUrl} --wait-time-seconds 10 --max-number-of-messages 1 | \\
      # Parse with jq and append to log
      jq -r '.Messages[] | ("Received message ID: " + .MessageId + " Body: " + .Body)' >> /home/ec2-user/sqs_messages.log
      # Pause between polls
      sleep 5
    done`;

    // Add commands to UserData
    userData.addCommands(
      // Add dummy command to force updates if needed
      'echo "UserData Update Trigger: $(date)" > /home/ec2-user/userdata_trigger.log',
      // Install tools
      'sudo yum update -y',
      'sudo yum install -y unzip jq',
      'echo "Installing AWS CLI v2..."',
      'curl "[https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip](https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip)" -o "awscliv2.zip"',
      'unzip awscliv2.zip',
      'sudo ./aws/install',
      'rm -rf aws awscliv2.zip',
      'echo "AWS CLI installed successfully."',
      // Write the entire script using a heredoc
      'echo "Creating polling script..."',
      `cat <<'EOF' > /home/ec2-user/poll_sqs.sh
${pollingScript}
EOF`,
      'chmod +x /home/ec2-user/poll_sqs.sh',
      // Ensure correct ownership
      'chown ec2-user:ec2-user /home/ec2-user/poll_sqs.sh',
      'touch /home/ec2-user/sqs_messages.log && chown ec2-user:ec2-user /home/ec2-user/sqs_messages.log',
      'touch /home/ec2-user/poll_sqs.out && chown ec2-user:ec2-user /home/ec2-user/poll_sqs.out',
      'touch /home/ec2-user/userdata_trigger.log && chown ec2-user:ec2-user /home/ec2-user/userdata_trigger.log',
      'echo "Polling script created."',
      // Run the script as ec2-user
      'echo "Starting polling script in background..."',
      'sudo -u ec2-user bash -c "nohup /home/ec2-user/poll_sqs.sh > /home/ec2-user/poll_sqs.out 2>&1 &"',
      'echo "UserData script finished."'
    );

    // --- EC2 Instance Definition (FORCE REPLACEMENT) ---
    // Keep forcing replacement for now until UserData is stable
    const instanceLogicalId = `ProcessingInstance-${Date.now()}`;
    const instance = new ec2.Instance(this, instanceLogicalId, { // Use dynamic logical ID
        vpc: vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
        machineImage: ec2.MachineImage.latestAmazonLinux2023(),
        securityGroup: ec2SecurityGroup,
        role: ec2Role,
        userData: userData, // Use the updated userData
    });

    // --- Stack Outputs ---
    new cdk.CfnOutput(this, 'InstanceIdOutput', { value: instance.instanceId });
    new cdk.CfnOutput(this, 'LookedUpVpcId', { value: vpc.vpcId });
  }
}
