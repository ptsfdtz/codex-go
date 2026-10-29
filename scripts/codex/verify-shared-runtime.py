"""Real local official-runtime acceptance; no simulated upstream or model results.

Run against a dedicated candidate state directory, never a daily Host. --model
opts into a real model task using the user's existing Codex authentication.
This verifies local sharing, not the cloud relay, GUI, or phone interaction.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import sys
import subprocess
import time
import uuid
from urllib.parse import urlsplit


class Native:
    def __init__(self, endpoint, token):
        url = urlsplit(endpoint)
        assert url.hostname in ('127.0.0.1', '::1') and url.scheme == 'ws'
        self.socket = socket.create_connection((url.hostname, url.port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.socket.sendall((f'GET / HTTP/1.1\r\nHost: {url.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer {token}\r\n\r\n').encode())
        headers = b''
        while not headers.endswith(b'\r\n\r\n'):
            headers += self.read(1)
            assert len(headers) < 16384
        if not headers.startswith(b'HTTP/1.1 101 '):
            self.socket.close()
            raise PermissionError('Native authentication rejected')
        accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        assert b'sec-websocket-accept: ' + accept.lower() in headers.lower()
        self.sequence = 0

    def read(self, size):
        data = b''
        while len(data) < size:
            chunk = self.socket.recv(size - len(data))
            if not chunk:
                raise ConnectionError('Native connection closed')
            data += chunk
        return data

    def frame(self, data, opcode=1):
        mask = os.urandom(4)
        size = len(data)
        header = bytes([0x80 | opcode, 0x80 | size]) if size < 126 else bytes([0x80 | opcode, 0x80 | 126]) + struct.pack('!H', size) if size < 65536 else bytes([0x80 | opcode, 0x80 | 127]) + struct.pack('!Q', size)
        self.socket.sendall(header + mask + bytes(value ^ mask[i % 4] for i, value in enumerate(data)))

    def send(self, value):
        self.frame(json.dumps(value).encode())

    def receive(self):
        data = b''
        while True:
            first, second = self.read(2)
            length = second & 127
            if length == 126:
                length = struct.unpack('!H', self.read(2))[0]
            elif length == 127:
                length = struct.unpack('!Q', self.read(8))[0]
            assert length <= 8 * 1024 * 1024 and not second & 128
            payload = self.read(length)
            if first & 15 == 8:
                raise ConnectionError('Native WebSocket closed')
            if first & 15 == 9:
                self.frame(payload, 10)
                continue
            if first & 15 == 10:
                continue
            data += payload
            assert len(data) <= 8 * 1024 * 1024
            if first & 128:
                return json.loads(data)

    def request(self, method, params):
        self.sequence += 1
        request_id = f'verify_{self.sequence}'
        self.send({'id': request_id, 'method': method, 'params': params})
        while True:
            packet = self.receive()
            if packet.get('id') == request_id and 'method' not in packet:
                if 'error' in packet:
                    raise RuntimeError(f'{method}: native error {packet["error"].get("code")}')
                return packet['result']

    def initialize(self):
        result = self.request('initialize', {'clientInfo': {'name': 'agentdeck-acceptance', 'version': '0.3.0'}, 'capabilities': {'experimentalApi': True}})
        self.send({'method': 'initialized', 'params': {}})
        return result

    def close(self):
        self.socket.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', type=Path, required=True)
    parser.add_argument('--data-directory', type=Path, required=True)
    parser.add_argument('--model', help='Opt into one real model task; requires existing Codex login')
    args = parser.parse_args()
    directory = args.data_directory.resolve()
    assert any('acceptance' in part for part in directory.parts), 'Use a dedicated *acceptance* state directory'
    cli = str(args.cli.resolve())
    env = dict(os.environ, AGENTDECK_DATA_DIR=str(directory))
    directory.mkdir(parents=True, exist_ok=True)
    report = {'passed': False, 'localOnly': True, 'modelRequested': bool(args.model), 'checks': {}}
    (directory / 'local-acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
    def run(*arguments):
        return subprocess.run([cli, *arguments], env=env, check=True, capture_output=True, text=True, timeout=1000).stdout
    result = json.loads(run('runtime-check'))
    assert result['officialPrecompiled'] and result['verification']['passed']
    report['runtime'] = result['origin']
    report['checks']['officialAndBoundary'] = True
    run('runtime-start')
    config = json.loads((directory / 'host.json').read_text())
    token = Path(config['runtimeTokenFile']).read_text().strip()
    before = json.loads((directory / 'shared-runtime-ready.json').read_text())
    run('runtime-start')
    after = json.loads((directory / 'shared-runtime-ready.json').read_text())
    assert before == after and token == Path(config['runtimeTokenFile']).read_text().strip()
    report['checks']['idempotentStart'] = True
    try:
        invalid = Native(config['runtimeWs'], 'x' * 43)
        invalid.close()
        raise AssertionError('Invalid token was accepted')
    except PermissionError:
        report['checks']['authenticationRejectsWrongToken'] = True
    first = Native(config['runtimeWs'], token)
    second = Native(config['runtimeWs'], token)
    thread = None
    try:
        assert result['version'] in first.initialize()['userAgent']
        assert result['version'] in second.initialize()['userAgent']
        project = directory / 'acceptance-project'
        project.mkdir(exist_ok=True)
        (project / 'AGENTS.md').write_text('This is an isolated runtime acceptance project. Execute only the requested acceptance command.\n')
        params = {'cwd': str(project), 'approvalPolicy': 'on-request', 'approvalsReviewer': 'user', 'config': {'default_permissions': 'agentdeck'}}
        if args.model:
            params['model'] = args.model
        thread = first.request('thread/start', params)['thread']['id']
        observed = second.request('thread/read', {'threadId': thread, 'includeTurns': False})['thread']
        assert observed['id'] == thread and observed['cwd'] == str(project)
        report['sessionId'] = thread
        report['checks']['twoClientsShareThread'] = True
        if args.model:
            target = project / 'official-runtime-proof.txt'
            expected = 'OFFICIAL_RUNTIME_ACCEPTANCE_OK_' + uuid.uuid4().hex
            target.unlink(missing_ok=True)
            prompt = f'Acceptance task: use your file editing tool to create official-runtime-proof.txt in the current project containing exactly {expected}. Read the file back using a tool. Do not access other projects, use network tools, or request escalation. Reply with the exact file content after checking it.'
            turn = first.request('turn/start', {'threadId': thread, 'input': [{'type': 'text', 'text': prompt}], 'permissions': 'agentdeck', 'approvalPolicy': 'on-request', 'approvalsReviewer': 'user', 'model': args.model})['turn']['id']
            tools = []
            end = time.monotonic() + 240
            seen_methods = set()
            first.socket.settimeout(60)
            while time.monotonic() < end:
                packet = first.receive()
                method, params = packet.get('method', ''), packet.get('params', {})
                if method not in seen_methods:
                    print('Native event:', method, 'fields:', ','.join(params.keys()) if isinstance(params, dict) else type(params).__name__, file=sys.stderr, flush=True)
                    seen_methods.add(method)
                if 'id' in packet and method:
                    # Never silently approve an unexpected escalation.
                    first.send({'id': packet['id'], 'result': {'decision': 'decline'}})
                    raise AssertionError('Unexpected approval during the bounded project task')
                if params.get('threadId') != thread:
                    continue
                if method == 'item/completed':
                    item = params.get('item', {})
                    if item.get('type') not in ('agentMessage', 'reasoning', 'userMessage'):
                        tools.append(item.get('type'))
                if method == 'turn/completed' and params.get('turn', {}).get('id') == turn:
                    assert params['turn']['status'] == 'completed', 'Real model turn failed'
                    break
            else:
                raise TimeoutError('Real model turn did not complete')
            assert tools and target.read_text().strip() == expected
            report['checks']['realModelFileWriteAndRead'] = True
            report['toolTypes'] = tools
            report['turnId'] = turn
        first.close()
        assert second.request('thread/read', {'threadId': thread, 'includeTurns': False})['thread']['id'] == thread
        report['checks']['clientDisconnectPreservesThread'] = True
        if args.model:
            resumed = second.request('thread/resume', {'threadId': thread})
            assert resumed['thread']['id'] == thread
            report['checks']['secondClientResumesCompletedThread'] = True
    finally:
        first.close()
        if thread:
            second.request('thread/archive', {'threadId': thread})
        second.close()
    report['passed'] = True
    (directory / 'local-acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
