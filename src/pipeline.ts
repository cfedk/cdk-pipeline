import * as cdk from '@aws-cdk/core';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as actions from '@aws-cdk/aws-codepipeline-actions';
import * as iam from '@aws-cdk/aws-iam';
import * as sns from '@aws-cdk/aws-sns';

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

interface ManualApprovalRequired {
    /**
     * Send a notification to this email address when a manual approval is required.
     */
    approvalNotificationEmail?: string;

    /**
     * Send an SNS message to this topic when a manual approval is required.
     */
    approvalNotificationTopic?: sns.ITopic;
}

type ManualApprovalConfiguration = ManualApprovalRequired | false;

export interface StageDefinition {
    /**
     * "Beta", "Prod", etc.
     */
    stageName: string;

    /**
     * Stack to deploy in this stage.
     */
    stack: cdk.Stack;

    /**
     * Configure manual approval requirements.
     * @default false;
     */
    manualApproval: ManualApprovalConfiguration;
}

export interface SourceConfiguration {
    /**
     * https://github.com/<owner>/<repository>
     */
    repository: string;

    /**
     * https://github.com/<owner>/<repository>
     */
    owner: string;

    /**
     * Name of key to which the Github access token is saved in SecretsManager.
     * Must be stored in the same region as the pipeline is being deployed to.
     *
     * `aws secretsmanager create-secret --name <oauthTokenName> --secret-string <github-secret> --region <pipeline-region>`
     *
     * The access token must have access to the repository in question and the permissions to create web hooks.
     */
    oauthTokenName: string;
}

export interface DeploymentPipelineProps {

    /**
     * Describe the repository which triggers pipeline deployments.
     */
    sourceConfiguration: SourceConfiguration,

    /**
     * Configure manual approval after pipeline deployments.
     */
    manualApproval: ManualApprovalConfiguration,

    /**
     * List of stages in deployment order.
     */
    deploymentStages: StageDefinition[],
}

export class DeploymentPipeline extends cdk.Stack {

    constructor(
        scope: cdk.Construct,
        stackName: string,
        stackProps: cdk.StackProps,
        props: DeploymentPipelineProps,
    ) {
        super(scope, `${stackName}Pipeline`, stackProps);

        // tslint:disable-next-line:no-unused-expression
        new DeploymentPipelineConstruct(this, props);
    }
}

/**
 * Visible for consumers which already have their own stack defined.
 */
export class DeploymentPipelineConstruct extends cdk.Construct {

    readonly pipeline: codepipeline.Pipeline;

    constructor(
            scope: cdk.Construct,
            props: DeploymentPipelineProps,
        ) {

        super(scope, 'DeploymentPipeline');

        const sourceActionOutput = new codepipeline.Artifact('Source');
        const buildActionOutput = new codepipeline.Artifact('Builds');

        this.pipeline = new codepipeline.Pipeline(this, 'Pipeline', { pipelineName: 'DeploymentPipeline' });

        const source = this.pipeline.addStage({ stageName: 'SourceStage' });

        source.addAction(new actions.GitHubSourceAction({
            actionName: 'SourceAction',
            repo: props.sourceConfiguration.repository,
            owner: props.sourceConfiguration.owner,
            oauthToken: cdk.SecretValue.secretsManager(props.sourceConfiguration.oauthTokenName),
            output: sourceActionOutput,
        }));

        const buildStage = this.pipeline.addStage({ stageName: 'BuildStage' });

        buildStage.addAction(new actions.CodeBuildAction({
            actionName: 'BuildAction',
            project: this.buildCodeBuildProject(),
            input: sourceActionOutput,
            outputs: [ buildActionOutput ],
        }));

        const pipelineStage = this.pipeline.addStage({
            stageName: 'DeployPipelineStage',
        });

        pipelineStage.addAction(new actions.CodeBuildAction({
            actionName: 'DeployPipelineAction',
            project: this.deployCodeBuildProject(cdk.Stack.of(this)),
            input: buildActionOutput,
        }));

        this.addManualApproval(pipelineStage, props.manualApproval);

        props.deploymentStages.forEach((stageDefinition) => {

            const stage = this.pipeline.addStage({
                stageName: `Deploy${stageDefinition.stageName}Stage`,
            });

            stage.addAction(new actions.CodeBuildAction({
                actionName: `Deploy${stageDefinition.stageName}Action`,
                project: this.deployCodeBuildProject(stageDefinition.stack),
                input: buildActionOutput,
            }));

            this.addManualApproval(stage, stageDefinition.manualApproval)
        });
    }

    private addManualApproval(stage: codepipeline.IStage, manualApprovalConfig: ManualApprovalConfiguration) {

        if (!manualApprovalConfig) {
            return;
        }

        const notifyEmails = manualApprovalConfig.approvalNotificationEmail
                ? [manualApprovalConfig.approvalNotificationEmail]
                : [];

        const notificationTopic = manualApprovalConfig.approvalNotificationTopic;

        stage.addAction(new actions.ManualApprovalAction({
            actionName: 'ManualApproval',
            notifyEmails,
            notificationTopic,
        }));
    }

    private buildCodeBuildProject(): codebuild.PipelineProject {
        return new codebuild.PipelineProject(this, 'Build', {
            projectName: 'Build',
            buildSpec: this.buildSpec('build.yaml'),
        });
    }

    private deployCodeBuildProject(stack: cdk.Stack): codebuild.PipelineProject {
        const stackName = stack.stackName;
        const project = new codebuild.PipelineProject(this, `Deploy${stackName}`, {
            projectName: `Deploy${stackName}`,
            buildSpec: this.buildSpec('deploy.yaml'),
            environmentVariables: {
                STACK_NAME: { value: stackName },
            },
        });

        project.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'));

        return project;
    }

    private buildSpec(name: string): codebuild.BuildSpec {
        // Need to inline the buildspec or codebuild will assume it's relative to the input artifact.
        const buildSpecSource = path.join(__dirname, '..', 'buildspec', name);
        const fileContents = fs.readFileSync(buildSpecSource, 'utf8');
        const buildSpecDefinition = yaml.safeLoad(fileContents);
        return codebuild.BuildSpec.fromObject(buildSpecDefinition);
    }
}

export function makeStack(
    app: cdk.App,
    stackName: string,
    stackProps: cdk.StackProps,
    stackPopulator: (scope: cdk.Construct) => cdk.Construct,
): cdk.Stack {
    const stack = new cdk.Stack(app, stackName, stackProps);
    stackPopulator(stack);
    return stack;
}

