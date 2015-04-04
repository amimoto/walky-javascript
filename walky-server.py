#!/usr/bin/python

"""
For this example, you'll need to install a number of python
modules that aren't marked as normal dependencies for walky.
You can get them automatically install via pip:

pip install -r python-requirements.txt

"""

import signal
import logging
import sys
import os
import datetime
import threading
import time

import flask

from tornado.wsgi import WSGIContainer
from walky.server.tornado import *

ASSETS_PATH = "assets"
STATIC_ASSETS_PATH = os.path.join(ASSETS_PATH,"static")
TEMPLATE_ASSETS_PATH = os.path.join(ASSETS_PATH,"templates")

root = logging.getLogger()
root.setLevel(logging.DEBUG)

ch = logging.StreamHandler(sys.stdout)
ch.setLevel(logging.DEBUG)

class TestWrapper(ObjectWrapper):
    _acls_ = [ [
        'anonymous',
        ALLOW_ALL,
        DENY_UNDERSCORED,
        MODE_READ|MODE_WRITE|MODE_EXECUTE, # mode
    ] ]

class TestClass(object):
    def myfunc(self):
        return 'func called'
    def getobj(self):
        return TestClass();
    def now(self,*args,**kwargs):
        return datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    some_param = 'param value'
    _c = 'should not be accessible due to wrapper rules'


class TestDocManip(object):
    def __init__(self,conn):
        self._conn = weakref.ref(conn)

    def control_page(self):
        conn = self._conn()

        doc = conn.object_get_remote('$')
        doc.jquery('#content').html(
          """
            <h1>THIS SHOULD HAVE SOME DATA</h1>
            So this is where it gets a little ridiculous.
            Yep.
          """
        )

        def update_time():
            fn = doc.jquery('#data').html
            ticks = 0
            while 1:
                ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                print "tick", ts
                fn(ts)
                time.sleep(1)
                ticks += 1
                if ticks % 2 == 0:
                  doc.jquery('#content').slideToggle()

        self._thread = threading.Thread(target=update_time)
        self._thread.daemon = True
        self._thread.start()

        """
            doc = conn.object_get_remote('$')
            fn = doc.jquery
            fn('#data').html(
                datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            )
            time.sleep(1)
        """

        return "FOO"


class MyEngine(Engine):
    def connection_new(self,connection_class=Connection,*args,**kwargs):
        sys_reg = Registry()
        tc = TestClass()
        conn = super(MyEngine,self).connection_new(
                                      connection_class=Connection,
                                      *args,
                                      **kwargs)
        conn.object_put(tc,'@')
        conn.object_put(TestDocManip(conn),'!')
        return conn

    def reset(self):
        super(MyEngine,self).reset()
        router = self.router
        router.mapper('anonymous',TestClass,TestWrapper)
        router.mapper('anonymous',TestDocManip,TestWrapper)

# Create the Flask App that will let us do http requests
app = flask.Flask(__name__,
                template_folder=TEMPLATE_ASSETS_PATH,
                static_folder=STATIC_ASSETS_PATH
                )

@app.route("/")
def route_index():
    return flask.render_template("index.html")

# Make the server with Flask embedded
wsgi_app = WSGIContainer(app)
server = TornadoServer(engine_class=MyEngine,wsgi_fallback_handler=wsgi_app)

# Just so we can exit cleanly
def handle_signal(sig, frame):
    IOLoop.instance().add_callback(IOLoop.instance().stop)
    server.shutdown()

signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

# Start the server
server.run()


