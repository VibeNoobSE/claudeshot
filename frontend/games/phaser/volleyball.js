registerGame("volleyball", "🏐 Volleyball", "A/D+W = P1, ←/→+↑ = P2", "Don't let the ball hit your side!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a2a3e");
    this.add.rectangle(W/2,H-10,W,20,0x2a3a5e); // ground
    this.add.rectangle(W/2,H-60,6,100,0x888888); // net
    this.p1=this.add.rectangle(150,H-40,28,40,0xf7c948);this.p2=this.add.rectangle(W-150,H-40,28,40,0xe94560);
    this.ball=this.add.circle(200,100,14,0xffffff);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setGravityY(800);});
    this.physics.add.existing(this.ball);this.ball.body.setCollideWorldBounds(true).setBounce(0.7).setGravityY(400).setDrag(10);
    this.net=this.add.rectangle(W/2,H-60,6,100);this.physics.add.existing(this.net,true);
    this.ground=this.add.rectangle(W/2,H-10,W,20);this.physics.add.existing(this.ground,true);
    this.physics.add.collider(this.p1,this.ground);this.physics.add.collider(this.p2,this.ground);
    this.physics.add.collider(this.ball,this.ground,()=>this.score());
    this.physics.add.collider(this.ball,this.net);
    this.physics.add.collider(this.p1,this.net);this.physics.add.collider(this.p2,this.net);
    this.physics.add.collider(this.ball,this.p1,(b)=>{b.body.setVelocity(Phaser.Math.Between(50,200),-350);});
    this.physics.add.collider(this.ball,this.p2,(b)=>{b.body.setVelocity(Phaser.Math.Between(-200,-50),-350);});
    this.s1=0;this.s2=0;
    this.scoreTxt=this.add.text(W/2,20,"0 — 0",{fontSize:"28px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({a:"A",d:"D",w:"W",left:"LEFT",right:"RIGHT",up:"UP"});
  }
  score(){
    if(this.ball.x<W/2)this.s2++;else this.s1++;
    this.scoreTxt.setText(this.s1+" — "+this.s2);
    this.ball.setPosition(this.ball.x<W/2?W-200:200,100);this.ball.body.setVelocity(0);
    if(this.s1>=11||this.s2>=11){this.physics.pause();this.add.text(W/2,H/2,(this.s1>=11?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
  }
  update(){const k=this.k;
    this.p1.body.setVelocityX(k.a.isDown?-250:k.d.isDown?250:0);
    if(k.w.isDown&&this.p1.body.touching.down)this.p1.body.setVelocityY(-500);
    this.p2.body.setVelocityX(k.left.isDown?-250:k.right.isDown?250:0);
    if(k.up.isDown&&this.p2.body.touching.down)this.p2.body.setVelocityY(-500);
    this.p1.x=Math.min(this.p1.x,W/2-20);this.p2.x=Math.max(this.p2.x,W/2+20);
  }
});
