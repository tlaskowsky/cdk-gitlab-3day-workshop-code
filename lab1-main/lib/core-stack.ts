// lib/core-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export class CoreStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly queue: sqs.Queue;

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

    // Outputs for easy reference
    new cdk.CfnOutput(this, 'InputBucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'ProcessingQueueUrl', { value: this.queue.queueUrl });
    new cdk.CfnOutput(this, 'ProcessingQueueArn', { value: this.queue.queueArn });
  }
}
