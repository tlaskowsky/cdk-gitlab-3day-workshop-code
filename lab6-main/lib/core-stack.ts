// lib/core-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as custom_resources from 'aws-cdk-lib/custom-resources';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export class CoreStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly queue: sqs.Queue;
  public readonly table: dynamodb.Table;
  public readonly ecrRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for document uploads
    this.bucket = new s3.Bucket(this, 'DocumentInputBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    // SQS queue for processing tasks
    this.queue = new sqs.Queue(this, 'DocumentProcessingQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // --- DynamoDB Table ---
    this.table = new dynamodb.Table(this, 'ProcessingResultsTable', {
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,

      pointInTimeRecovery: true, // <<< ENSURE THIS IS SET TO TRUE
    });

    // --- S3 Event Notification to SQS ---
    this.bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(this.queue),
      { suffix: '.pdf' } // Filter for PDF files
    );

    // Inside CoreStack constructor, after table definition
    // --- Custom Resource for DDB Seeding (Using NodejsFunction) ---

    // Define the NodejsFunction - CDK handles bundling SDK v3 dependencies
    const seedHandler = new lambda_nodejs.NodejsFunction(this, 'DDBSeedHandler', {
      runtime: lambda.Runtime.NODEJS_18_X, // Or NODEJS_20_X
      entry: 'lambda/seed-ddb.ts', // Path relative to project root (where cdk.json is)
      handler: 'handler', // Function name in the handler file
      timeout: cdk.Duration.minutes(1),
      environment: {
        TABLE_NAME: this.table.tableName, // Pass table name to Lambda
      },
      bundling: { // Optional: Configure bundling options if needed
        minify: false, // Easier debugging
      },
    });

    // Grant the Lambda function permissions to write to the table
    this.table.grantWriteData(seedHandler);

    // Create the Custom Resource Provider using the NodejsFunction
    const seederProvider = new custom_resources.Provider(this, 'DDBSeedProvider', {
      onEventHandler: seedHandler, // Reference the NodejsFunction
    });

    // Create the Custom Resource itself, triggering the provider
    new cdk.CustomResource(this, 'DDBSeedResource', {
      serviceToken: seederProvider.serviceToken,
      properties: {
        // Pass properties to the Lambda if needed (used for PhysicalResourceId here)
        SeedJobId: `seed-item-${this.stackName}`, // Example property
        // Add a changing property to ensure the resource updates when code/props change
        // Timestamp: Date.now().toString()
      }
    });

    // --- Monitoring & Alerting ---
    const alarmTopic = new sns.Topic(this, 'AlarmTopic');
    alarmTopic.addSubscription(new subs.EmailSubscription('tlaskowsky@gmail.com')); // <<< REPLACE EMAIL

    const queueDepthMetric = this.queue.metricApproximateNumberOfMessagesVisible({
      period: cdk.Duration.minutes(1),
      statistic: 'Maximum',
    });

    const queueDepthAlarm = new cloudwatch.Alarm(this, 'QueueDepthAlarm', {
      alarmName: `${this.stackName}-QueueDepthAlarm`,
      alarmDescription: 'Alarm if SQS queue depth exceeds threshold',
      metric: queueDepthMetric,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    queueDepthAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: alarmTopic.topicArn });

    // Inside CoreStack constructor
    const prefix = this.node.tryGetContext('prefix') || `stu20-${this.node.tryGetContext('environment') || 'dev'}`;

    // --- ECR Repository ---
    this.ecrRepo = new ecr.Repository(this, 'ProcessingAppRepo', {
      repositoryName: `${prefix}-processor-repo`.toLowerCase(),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteImages: true,
      imageScanOnPush: true,
    });

    // Output Repository URI
    new cdk.CfnOutput(this, 'EcrRepoUri', { value: this.ecrRepo.repositoryUri });


    // --- Stack Outputs (Add Table Name) ---
    new cdk.CfnOutput(this, 'ResultsTableName', {
      value: this.table.tableName,
      description: 'Name of the DynamoDB table for results',
    });

    // Outputs for easy reference
    new cdk.CfnOutput(this, 'InputBucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'ProcessingQueueUrl', { value: this.queue.queueUrl });
    new cdk.CfnOutput(this, 'ProcessingQueueArn', { value: this.queue.queueArn });
  }
}
