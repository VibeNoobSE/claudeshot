registerGame("soccer", "⚽ Soccer", "WASD = P1, Arrows = P2", "First to 5 goals!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a4a1a");
    this.add.rectangle(W/2,H/2,W-60,H-60).setStrokeStyle(2,0xffffff);
    this.add.circle(W/2,H/2,50).setStrokeStyle(1,0xffffff);
    this.add.rectangle(W/2,H/2,2,H-60,0x446644);
    this.add.rectangle(32,H/2,4,100,0xf7c948);this.add.rectangle(W-32,H/2,4,100,0xe94560);
    this.p1=this.add.circle(150,H/2,16,0xf7c948);this.p2=this.add.circle(W-150,H/2,16,0xe94560);
    this.ball=this.add.circle(W/2,H/2,10,0xffffff);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setDrag(200);});
    this.physics.add.existing(this.ball);this.ball.body.setCollideWorldBounds(true).setBounce(0.8).setDrag(30).setMaxVelocity(400);
    this.physics.add.collider(this.p1,this.p2);
    this.physics.add.collider(this.p1,this.ball);this.physics.add.collider(this.p2,this.ball);
    this.s1=0;this.s2=0;
    this.sTxt=this.add.text(W/2,16,"0 — 0",{fontSize:"28px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
  }
  update(){const s=300,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
    if(this.ball.x<35&&Math.abs(this.ball.y-H/2)<50){this.s2++;this.reset();}
    if(this.ball.x>W-35&&Math.abs(this.ball.y-H/2)<50){this.s1++;this.reset();}
  }
  reset(){this.sTxt.setText(this.s1+" — "+this.s2);this.ball.setPosition(W/2,H/2);this.ball.body.setVelocity(0);
    if(this.s1>=5||this.s2>=5)this.add.text(W/2,H/2,(this.s1>=5?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
});
