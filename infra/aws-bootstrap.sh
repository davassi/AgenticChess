#!/usr/bin/env bash
#
# Every AWS call behind the production host, in order, so the account can be
# rebuilt from this repository without a Terraform state to keep alive.
#
# Idempotent: each step checks for what it would create and skips it. Run it
# again to see what is missing, not to get a second copy.
#
#   ./infra/aws-bootstrap.sh
#
# It does not deploy the application. That is deploy/deploy.sh, on the host.
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
NAME="${STACK_NAME:-agenticchess-prod}"
DOMAIN="${DOMAIN:-agenticchess.online}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.medium}"
VOLUME_GB="${VOLUME_GB:-30}"
# The address allowed to reach SSH. Everything else arrives on 80 and 443.
ADMIN_CIDR="${ADMIN_CIDR:-$(curl -fsS https://api.ipify.org)/32}"
KEY_FILE="${KEY_FILE:-$HOME/.ssh/$NAME.pem}"

export AWS_DEFAULT_REGION="$REGION"

say() { printf '\n==> %s\n' "$1"; }

# --- Ubuntu 24.04 LTS, resolved through SSM so the AMI id is never stale ---
AMI_ID="$(aws ssm get-parameter \
  --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --query 'Parameter.Value' --output text)"
say "AMI $AMI_ID"

VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
SUBNET_ID="$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" Name=default-for-az,Values=true \
  --query 'Subnets[0].SubnetId' --output text)"
say "VPC $VPC_ID subnet $SUBNET_ID"

# --- Key pair. The private half exists only on the operator's machine; AWS
# keeps no copy, so losing the file means rebuilding the key. ---
say "key pair"
if aws ec2 describe-key-pairs --key-names "$NAME" >/dev/null 2>&1; then
  echo "exists"
else
  aws ec2 create-key-pair --key-name "$NAME" --key-type ed25519 \
    --query KeyMaterial --output text > "$KEY_FILE"
  chmod 400 "$KEY_FILE"
  echo "created $KEY_FILE"
fi

# --- Security group: SSH from the operator only, HTTP and HTTPS from
# anywhere. The API, the worker health port, Postgres and Redis are never
# published; they live on the compose network. ---
say "security group"
SG_ID="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$NAME" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID="$(aws ec2 create-security-group --group-name "$NAME" \
    --description "AgenticChess production" --vpc-id "$VPC_ID" \
    --query GroupId --output text)"
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$ADMIN_CIDR,Description=admin SSH}]" \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP and ACME}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTPS}]' >/dev/null
fi
echo "$SG_ID"

# --- Instance role. SSM Session Manager is what makes the single-address SSH
# rule safe to keep: a changed home address is an inconvenience, not a
# lockout. ---
say "instance profile"
if ! aws iam get-instance-profile --instance-profile-name "$NAME-instance" >/dev/null 2>&1; then
  aws iam create-role --role-name "$NAME-instance" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$NAME-instance" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws iam create-instance-profile --instance-profile-name "$NAME-instance" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$NAME-instance" \
    --role-name "$NAME-instance"
  sleep 10 # the profile is not usable the instant it is created
fi
echo "$NAME-instance"

# --- Elastic IP. Allocated before the instance so the DNS records can be
# published while the machine is still building: Let's Encrypt cannot issue a
# certificate until the names resolve, and it rate limits failed attempts. ---
say "elastic ip"
ALLOC_ID="$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=$NAME" \
  --query 'Addresses[0].AllocationId' --output text 2>/dev/null || true)"
if [ -z "$ALLOC_ID" ] || [ "$ALLOC_ID" = "None" ]; then
  ALLOC_ID="$(aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" \
    --query AllocationId --output text)"
fi
EIP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)"
echo "$EIP"

# --- Instance. IMDSv2 required, so a server-side request forgery in the
# application cannot read the instance credentials. ---
say "instance"
INSTANCE_ID="$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=$NAME" 'Name=instance-state-name,Values=pending,running,stopped' \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)"
if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  INSTANCE_ID="$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$NAME" \
    --security-group-ids "$SG_ID" \
    --subnet-id "$SUBNET_ID" \
    --iam-instance-profile "Name=$NAME-instance" \
    --metadata-options 'HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled' \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":$VOLUME_GB,\"VolumeType\":\"gp3\",\"Encrypted\":true,\"DeleteOnTermination\":true}}]" \
    --user-data "file://$(dirname "$0")/../deploy/provision.sh" \
    --tag-specifications \
      "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=agenticchess}]" \
      "ResourceType=volume,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=agenticchess},{Key=Backup,Value=daily}]" \
    --query 'Instances[0].InstanceId' --output text)"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
fi
echo "$INSTANCE_ID"

say "associating $EIP"
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null

# --- Daily EBS snapshots. Recovers the machine; deploy/backup.sh recovers the
# data. Two layers because they fail in different ways. ---
say "snapshot policy"
DLM_ROLE_ARN="arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/AWSDataLifecycleManagerDefaultRole"
if ! aws iam get-role --role-name AWSDataLifecycleManagerDefaultRole >/dev/null 2>&1; then
  aws iam create-role --role-name AWSDataLifecycleManagerDefaultRole \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"dlm.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name AWSDataLifecycleManagerDefaultRole \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole
  sleep 10
fi
if [ -z "$(aws dlm get-lifecycle-policies --query "Policies[?Description=='$NAME daily snapshots'].PolicyId" --output text)" ]; then
  aws dlm create-lifecycle-policy \
    --description "$NAME daily snapshots" \
    --state ENABLED \
    --execution-role-arn "$DLM_ROLE_ARN" \
    --policy-details "{
      \"PolicyType\": \"EBS_SNAPSHOT_MANAGEMENT\",
      \"ResourceTypes\": [\"VOLUME\"],
      \"TargetTags\": [{\"Key\": \"Backup\", \"Value\": \"daily\"}],
      \"Schedules\": [{
        \"Name\": \"daily\",
        \"CreateRule\": {\"Interval\": 24, \"IntervalUnit\": \"HOURS\", \"Times\": [\"02:00\"]},
        \"RetainRule\": {\"Count\": 7},
        \"CopyTags\": true
      }]
    }" >/dev/null
fi
echo "enabled"

cat <<SUMMARY

  instance   $INSTANCE_ID  ($INSTANCE_TYPE, $VOLUME_GB GB gp3, encrypted)
  address    $EIP
  ssh        ssh -i $KEY_FILE ubuntu@$EIP
  console    aws ssm start-session --target $INSTANCE_ID --region $REGION

  DNS, three A records at TTL 300, all to $EIP:
    @    $DOMAIN
    www  www.$DOMAIN
    api  api.$DOMAIN

  They must resolve before the stack first starts, or the ACME challenge
  fails and Let's Encrypt applies its rate limit.

  Then, on the host: docs/deployment.md
SUMMARY
