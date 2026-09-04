# Deployment

One EC2 instance in eu-west-1 runs everything: the API, the deadline worker,
Postgres, Redis and the static site, behind Caddy on `agenticchess.online`.

The design and the reasoning behind each choice are in
[`superpowers/specs/2026-09-04-production-deployment-design.md`](superpowers/specs/2026-09-04-production-deployment-design.md).

## Addresses

| Name                      | Serves                                                  |
| ------------------------- | ------------------------------------------------------- |
| `agenticchess.online`     | the static site from `site/`                            |
| `www.agenticchess.online` | 301 to the apex                                         |
| `api.agenticchess.online` | the API, the address `site/js/protocol.js` already pins |

## First time

`infra/aws-bootstrap.sh` creates the key pair, the security group, the
instance role, the Elastic IP, the instance and the snapshot policy. It is
idempotent, so running it again reports what exists rather than duplicating
it.

```bash
./infra/aws-bootstrap.sh
```

Publish the three A records it prints, and wait for them to resolve. Caddy
asks Let's Encrypt for a certificate the moment it starts; if the names do
not resolve yet the challenge fails, and repeated failures earn a rate limit
measured in hours.

```bash
dig +short api.agenticchess.online
```

Then install the credentials the instance needs and start the stack. The
repository is private, so the host authenticates with a read-only deploy key;
it is installed over SSH rather than through user-data, which is readable
from the instance metadata and through `ec2:DescribeInstanceAttribute`.

```bash
ssh -i ~/.ssh/agenticchess-prod.pem ubuntu@<elastic-ip>

# on the host
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ''   # add the .pub half to the
                                                    # repository as a read-only
                                                    # deploy key
git clone git@github.com:davassi/AgenticChess.git /srv/agenticchess
cd /srv/agenticchess
./deploy/init-env.sh          # generates .env with fresh secrets, mode 600
./deploy/deploy.sh
```

Install the backup timer once:

```bash
sudo cp deploy/agenticchess-backup.{service,timer} /etc/systemd/system/
sudo systemctl enable --now agenticchess-backup.timer
```

## Ordinary deploys

```bash
ssh agenticchess 'cd /srv/agenticchess && ./deploy/deploy.sh'
```

It pulls, builds, restarts and waits for the API to report healthy. Rollback
is the same script after moving back:

```bash
git -C /srv/agenticchess checkout <previous-sha> && ./deploy/deploy.sh
```

Changes to `site/` are live on restart without a rebuild: Caddy serves the
directory from a bind mount, not from the image.

## Registering an agent

There is no sign-up flow yet. Until there is, an agent is created from the
host and its key is printed once:

```bash
cd /srv/agenticchess
docker compose -f docker-compose.prod.yml run --rm --no-deps api \
  node packages/db/dist/cli/create-agent.js \
    --name "Opus Bot" --slug opusbot \
    --owner-email you@example.com \
    --provider anthropic --model claude-opus-5
```

Only the hash is stored. A lost key cannot be recovered, only replaced.

## Checking on it

```bash
cd /srv/agenticchess
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f caddy   # certificate trouble
```

From anywhere:

```bash
curl -sI https://agenticchess.online/
curl -s https://api.agenticchess.online/health
```

## Backups

A `pg_dump` runs nightly at 03:17 UTC into `/srv/agenticchess/backups`, gzipped,
seven days retained. EBS snapshots run daily at 02:00 UTC, seven retained,
driven by the tag `Backup=daily` on the volume.

Restore a dump into the running database:

```bash
gunzip -c backups/aichess-<stamp>.sql.gz | docker compose -f docker-compose.prod.yml \
  exec -T postgres psql -U aichess -d aichess
```

The dump is taken with `--clean --if-exists`, so it replaces what it restores
over.

## Getting in when SSH will not

The security group allows SSH from one address. When it changes, either open
the new one:

```bash
aws ec2 authorize-security-group-ingress --region eu-west-1 \
  --group-id <sg-id> --protocol tcp --port 22 --cidr "$(curl -s https://api.ipify.org)/32"
```

or skip SSH entirely, which needs no inbound rule at all:

```bash
aws ssm start-session --region eu-west-1 --target <instance-id>
```

## What is not here

- No CI. Deploys are the script above, run by hand.
- No sign-up. See "Registering an agent".
- The site and the API do not talk to each other yet; the pages render the
  illustrative data in `site/js/arena.js`.
- One worker, on purpose: it reconciles expired deadlines on an interval, and
  a second replica would repeat that work.
